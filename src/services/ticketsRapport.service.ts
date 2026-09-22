import { db } from '../database';

/**
 * Ce que les demandes coûtent, et ce qu'on tient comme délais.
 *
 * ## La moyenne seule ment
 *
 * Un délai de résolution moyen n'est pas une information : une demande qui
 * traîne six mois — le rideau qu'on ne peut commander qu'au budget suivant —
 * tire la moyenne d'un service qui répond par ailleurs en deux heures. Présenté
 * en réunion, ce chiffre fait conclure l'inverse de la réalité.
 *
 * On rend donc **la médiane et la moyenne côte à côte**, et l'écart entre les
 * deux se lit comme un renseignement à part entière : quand la moyenne est le
 * double de la médiane, quelques dossiers bloqués pèsent sur le total, et c'est
 * eux qu'il faut regarder — pas l'équipe.
 *
 * ## Les délais se mesurent sur ce qui est clos
 *
 * Une demande encore ouverte n'a pas de délai de résolution : l'inclure avec
 * son âge courant ferait baisser la moyenne à mesure qu'on ouvre des demandes,
 * ce qui est absurde. Les demandes ouvertes sont comptées à part, avec leur
 * âge — c'est une mesure de charge, pas de performance.
 *
 * ## Le temps passé vient des plannings
 *
 * Il n'y a pas de seconde comptabilité d'heures : `planning_taches.ticket_id`
 * porte le rattachement, et le temps d'une demande est la somme du temps de son
 * titulaire et de ses renforts — les deux mesures que le module Plannings
 * distingue déjà, et qu'on ne mélange jamais.
 */

export interface BornesRapport {
  debut: string;
  fin: string;
}

export interface Repartition {
  cle: string;
  libelle: string;
  total: number;
  /** Part du total, en pourcentage entier — la somme peut faire 99 ou 101. */
  part: number;
}

export interface Delais {
  /** Nombre de demandes sur lesquelles la mesure porte. */
  mesurees: number;
  medianeMinutes: number | null;
  moyenneMinutes: number | null;
  /** Combien ont tenu leur échéance, parmi celles qui en avaient une. */
  dansLesDelais: number;
  horsDelais: number;
}

export interface RapportTickets {
  periode: BornesRapport;
  ouvertes: number;
  closes: number;
  enCours: number;
  enRetard: number;
  priseEnCharge: Delais;
  resolution: Delais;
  parStatut: Repartition[];
  parCategorie: Repartition[];
  parBatiment: Repartition[];
  parTechnicien: Repartition[];
  tempsPasseMinutes: number;
  tempsParCategorie: Repartition[];
}

/** Les minutes entre deux horodatages, ou `null` si l'un manque. */
function minutesEntre(debut: unknown, fin: unknown): number | null {
  if (!debut || !fin) return null;
  const d = new Date(String(debut).replace(' ', 'T')).getTime();
  const f = new Date(String(fin).replace(' ', 'T')).getTime();
  if (!Number.isFinite(d) || !Number.isFinite(f) || f < d) return null;
  return Math.round((f - d) / 60000);
}

/**
 * La médiane d'une série.
 *
 * Calculée en JavaScript et non en SQL : ni SQLite ni MySQL 5.7 n'ont de
 * fonction de percentile, et l'émuler en SQL demanderait une sous-requête
 * corrélée par ligne — dialectale et lente. Les volumes se comptent en
 * milliers, pas en millions.
 */
export function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 0
    ? Math.round((triees[milieu - 1] + triees[milieu]) / 2)
    : triees[milieu];
}

export function moyenne(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  return Math.round(valeurs.reduce((total, v) => total + v, 0) / valeurs.length);
}

/** Groupe des lignes et rend une répartition triée, part comprise. */
function repartir(
  lignes: Array<{ cle: unknown; libelle: unknown }>,
  libelleVide: string
): Repartition[] {
  const totaux = new Map<string, { libelle: string; total: number }>();

  for (const ligne of lignes) {
    const cle = ligne.cle === null || ligne.cle === undefined ? '' : String(ligne.cle);
    const libelle = ligne.libelle ? String(ligne.libelle) : libelleVide;
    const courant = totaux.get(cle) ?? { libelle, total: 0 };
    courant.total += 1;
    totaux.set(cle, courant);
  }

  const total = lignes.length || 1;
  return [...totaux.entries()]
    .map(([cle, v]) => ({
      cle,
      libelle: v.libelle,
      total: v.total,
      part: Math.round((v.total / total) * 100),
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Le rapport d'une période, dans la portée du lecteur.
 *
 * `portee` vient de `porteeTickets()` : un rapport ne doit jamais compter des
 * demandes que son lecteur n'a pas le droit de voir. Un superviseur du service
 * technique qui verrait « 340 demandes ce mois » alors qu'il n'en voit que 120
 * n'y comprendrait rien, et le chiffre fuiterait l'activité des autres.
 */
export async function construireRapport(
  portee: { sql: string; params: any[] },
  bornes: BornesRapport
): Promise<RapportTickets> {
  const lignes = await db.query(
    `SELECT t.id, t.statut_id, t.categorie_id, t.site_id, t.technicien_id,
            t.created_at, t.pris_en_charge_at, t.resolu_at, t.ferme_at,
            t.echeance_prise_en_charge, t.echeance_resolution,
            st.nom AS statut_nom, st.is_ouvert AS statut_ouvert,
            c.nom AS categorie_nom, s.name AS site_nom,
            tech.first_name AS tech_prenom, tech.last_name AS tech_nom
       FROM tickets t
       LEFT JOIN ticket_statuts st ON st.id = t.statut_id
       LEFT JOIN ticket_categories c ON c.id = t.categorie_id
       LEFT JOIN cle_sites s ON s.id = t.site_id
       LEFT JOIN users tech ON tech.id = t.technicien_id
      WHERE t.created_at >= ? AND t.created_at <= ?${portee.sql}`,
    [bornes.debut, `${bornes.fin} 23:59:59`, ...portee.params]
  );

  const closes = lignes.filter((l: any) => l.ferme_at);
  const ouvertes = lignes.filter((l: any) => !l.ferme_at);

  const delaisPriseEnCharge = lignes
    .map((l: any) => minutesEntre(l.created_at, l.pris_en_charge_at))
    .filter((v: number | null): v is number => v !== null);

  const delaisResolution = closes
    .map((l: any) => minutesEntre(l.created_at, l.resolu_at ?? l.ferme_at))
    .filter((v: number | null): v is number => v !== null);

  /** Combien ont tenu une échéance qu'elles avaient. */
  const compterEcheance = (
    candidats: any[],
    colonneEcheance: string,
    colonneAtteinte: string
  ): { dansLesDelais: number; horsDelais: number } => {
    let dansLesDelais = 0;
    let horsDelais = 0;
    for (const ligne of candidats) {
      const echeance = ligne[colonneEcheance];
      const atteinte = ligne[colonneAtteinte];
      if (!echeance || !atteinte) continue;
      if (String(atteinte) <= String(echeance)) dansLesDelais += 1;
      else horsDelais += 1;
    }
    return { dansLesDelais, horsDelais };
  };

  const priseEnCharge = compterEcheance(lignes, 'echeance_prise_en_charge', 'pris_en_charge_at');
  const resolution = compterEcheance(closes, 'echeance_resolution', 'resolu_at');

  const maintenant = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const enRetard = ouvertes.filter(
    (l: any) => l.echeance_resolution && String(l.echeance_resolution) < maintenant
  ).length;

  // ------------------------------------------------------- le temps passé

  const ids = lignes.map((l: any) => Number(l.id));
  let tempsPasseMinutes = 0;
  const tempsParCategorie = new Map<string, { libelle: string; total: number }>();

  if (ids.length > 0) {
    const marqueurs = ids.map(() => '?').join(',');
    // Le temps **mobilisé** : celui du titulaire, plus celui de chaque renfort.
    // C'est la mesure qui répond à « ce que cette demande a coûté », et non
    // « ce que la journée de quelqu'un a contenu » — les deux ne s'additionnent
    // jamais, et le module Plannings les distingue déjà.
    const heures = await db.query(
      `SELECT pt.ticket_id, pt.minutes,
              (SELECT COALESCE(SUM(pp.minutes), 0) FROM planning_participants pp WHERE pp.tache_id = pt.id) AS renforts
         FROM planning_taches pt
        WHERE pt.ticket_id IN (${marqueurs})`,
      ids
    );

    const categorieParTicket = new Map(
      lignes.map((l: any) => [Number(l.id), l.categorie_nom ?? 'Sans catégorie'])
    );

    for (const h of heures) {
      const minutes = Number(h.minutes ?? 0) + Number(h.renforts ?? 0);
      tempsPasseMinutes += minutes;

      const libelle = categorieParTicket.get(Number(h.ticket_id)) ?? 'Sans catégorie';
      const courant = tempsParCategorie.get(libelle) ?? { libelle, total: 0 };
      courant.total += minutes;
      tempsParCategorie.set(libelle, courant);
    }
  }

  const totalTemps = tempsPasseMinutes || 1;

  return {
    periode: bornes,
    ouvertes: lignes.length,
    closes: closes.length,
    enCours: ouvertes.length,
    enRetard,
    priseEnCharge: {
      mesurees: delaisPriseEnCharge.length,
      medianeMinutes: mediane(delaisPriseEnCharge),
      moyenneMinutes: moyenne(delaisPriseEnCharge),
      ...priseEnCharge,
    },
    resolution: {
      mesurees: delaisResolution.length,
      medianeMinutes: mediane(delaisResolution),
      moyenneMinutes: moyenne(delaisResolution),
      ...resolution,
    },
    parStatut: repartir(
      lignes.map((l: any) => ({ cle: l.statut_id, libelle: l.statut_nom })),
      'Sans état'
    ),
    parCategorie: repartir(
      lignes.map((l: any) => ({ cle: l.categorie_id, libelle: l.categorie_nom })),
      'Sans catégorie'
    ),
    parBatiment: repartir(
      lignes.map((l: any) => ({ cle: l.site_id, libelle: l.site_nom })),
      'Sans bâtiment'
    ),
    parTechnicien: repartir(
      lignes.map((l: any) => ({
        cle: l.technicien_id,
        libelle: [l.tech_prenom, l.tech_nom].filter(Boolean).join(' ').trim() || null,
      })),
      'Non affectée'
    ),
    tempsPasseMinutes,
    tempsParCategorie: [...tempsParCategorie.values()]
      .map((v) => ({
        cle: v.libelle,
        libelle: v.libelle,
        total: v.total,
        part: Math.round((v.total / totalTemps) * 100),
      }))
      .sort((a, b) => b.total - a.total),
  };
}

/**
 * Les demandes d'un matériel, pour sa fiche.
 *
 * C'est ce qui donne son sens au rattachement : « souci de bruit sur le Nemo »
 * apparaît enfin dans l'historique du Nemo, aux côtés de ses entretiens. La
 * portée est celle du lecteur — la fiche ne révèle pas les demandes qu'il n'a
 * pas le droit de voir.
 */
export async function demandesDuMateriel(
  portee: { sql: string; params: any[] },
  objectId: number | string
): Promise<any[]> {
  return db.query(
    `SELECT t.id, t.reference, t.titre, t.created_at, t.resolu_at, t.ferme_at,
            st.nom AS statut_nom, st.couleur AS statut_couleur, st.is_ouvert AS statut_ouvert,
            c.nom AS categorie_nom,
            d.first_name AS demandeur_prenom, d.last_name AS demandeur_nom
       FROM tickets t
       LEFT JOIN ticket_statuts st ON st.id = t.statut_id
       LEFT JOIN ticket_categories c ON c.id = t.categorie_id
       LEFT JOIN users d ON d.id = t.demandeur_id
      WHERE t.object_id = ?${portee.sql}
      ORDER BY t.created_at DESC`,
    [objectId, ...portee.params]
  );
}
