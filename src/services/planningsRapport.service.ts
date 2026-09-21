import { db } from '../database';
import {
  Bornes,
  Granularite,
  cleDePeriode,
  granularitePour,
  libelleDePeriode,
  nombreDeJours,
  periodesEntre,
  versJour,
} from '../utils/periodes';
import {
  Categorie,
  FiltresTaches,
  Perimetre,
  construireFiltres,
  listerCategories,
  nomComplet,
} from './plannings.service';

/**
 * Les rapports : combien de temps, sur quoi, et comparé à quand.
 *
 * Tout part d'un même jeu de **lignes de temps**. Une tâche n'en produit pas
 * une mais autant qu'elle a de contributeurs : celle de son titulaire, plus
 * celle de chaque renfort. Deux agents une heure sur la même livraison font
 * donc deux lignes d'une heure, et un renfort de trente minutes sur une tâche
 * de deux heures en fait une de 120 et une de 30.
 *
 * De là viennent les deux mesures, qu'il ne faut jamais additionner :
 *
 *   « temps total mobilisé »  toutes les lignes — ce que la tâche a coûté à la
 *                             collectivité : 2 h 30 dans l'exemple.
 *   « temps d'une personne »  les lignes de cette personne — ce que la journée
 *                             de quelqu'un a contenu : 2 h pour le titulaire,
 *                             30 min pour le renfort.
 *
 * **Le piège, et c'est le cœur du fichier** : filtrer par personne ne se fait
 * pas au même endroit selon la mesure. Si le filtre est posé sur la ligne dans
 * les deux cas, les deux mesures rendent la même valeur dès qu'on filtre par
 * personne — c'est-à-dire exactement quand on les regarde, et « mobilisé »
 * devient un synonyme de « personne » sans que rien ne le signale. Pour le
 * temps mobilisé, le filtre porte donc sur la **tâche** : on retient les tâches
 * où la personne est intervenue, puis on somme *toutes* leurs lignes.
 *
 * Le découpage en semaines, mois et années se fait ensuite en JavaScript. Le
 * faire en SQL demanderait deux écritures — `strftime` et `DATE_FORMAT` — dont
 * aucune n'est ISO et qui ne s'accordent pas sur la première semaine de
 * l'année ; et il faudrait de toute façon reconstruire en JavaScript les
 * périodes vides, qu'un `GROUP BY` ne rend jamais.
 */

export type Mesure = 'mobilise' | 'personne';

export interface FiltresRapport extends FiltresTaches {
  mesure: Mesure;
  /** La personne observée. Absente, le rapport porte sur tout le périmètre. */
  personneId?: number | null;
  /**
   * Le découpage de la série d'évolution : une barre par jour, par semaine…
   * Il suit la longueur de la période et n'a rien à voir avec sa nature.
   */
  granularite?: Granularite;
  /**
   * La **nature** de la période demandée : une semaine, un mois, une année.
   *
   * Séparée de `granularite`, et pour une bonne raison : une semaine se
   * découpe en jours, si bien que confondre les deux faisait intituler le
   * rapport « 21 septembre 2026 » au lieu de « Semaine 39 », et surtout le
   * faisait comparer à la **veille** au lieu de la semaine précédente.
   */
  typePeriode?: Granularite;
}

/** Une ligne de temps, déjà repliée au jour. */
export interface LigneDeTemps {
  jour: string;
  personneId: number | null;
  libelle: string | null;
  categorieId: number | null;
  manifestationId: number | null;
  minutes: number;
}

export interface Part {
  id: number | null;
  libelle: string;
  couleur?: string;
  minutes: number;
  /** Fraction du total, entre 0 et 1. `null` si le total est nul. */
  part: number | null;
}

export interface SeriePeriode {
  cle: string;
  libelle: string;
  libelleLong: string;
  debut: string;
  fin: string;
  minutes: number;
}

export interface Rapport {
  periode: Bornes & {
    libelle: string;
    jours: number;
    granularite: Granularite;
    typePeriode: Granularite;
  };
  mesure: Mesure;
  total: { minutes: number; taches: number; personnes: number };
  parPeriode: SeriePeriode[];
  parCategorie: Part[];
  parPersonne: Part[];
  parManifestation: Part[];
}

export interface Comparaison {
  reference: Rapport;
  ecart: { minutes: number; pourcentage: number | null };
  parCategorie: {
    id: number | null;
    libelle: string;
    couleur?: string;
    minutes: number;
    minutesReference: number;
    ecart: number;
    pourcentage: number | null;
  }[];
}

const SANS_CATEGORIE = 'Sans catégorie';
const RENFORTS_ANONYMES = 'Renforts non nominatifs';

/**
 * Les lignes de temps, repliées au jour.
 *
 * Le repli en SQL divise le volume par le nombre de tâches d'une journée sans
 * rien perdre de ce que les axes ont besoin de distinguer. Ce qui remonte est
 * ensuite regroupé en JavaScript, autant de fois qu'il y a d'axes, sur un seul
 * aller-retour à la base.
 */
export async function lignesDeTemps(
  filtres: FiltresRapport,
  perimetre: Perimetre
): Promise<LigneDeTemps[]> {
  if (!perimetre.tout && perimetre.personnes.length === 0) return [];

  // Le filtre par personne s'applique aux **tâches** dans les deux mesures :
  // il ne retient que celles où elle est intervenue, en titulaire ou en
  // renfort. C'est ensuite, et seulement pour la mesure « personne », qu'on
  // réduit aux lignes qui sont les siennes.
  const filtresTache: FiltresTaches = filtres.personneId
    ? { ...filtres, personneIds: [Number(filtres.personneId)] }
    : filtres;

  const { sql: conditions, params } = construireFiltres(filtresTache, perimetre);

  const restreindreALaPersonne = filtres.mesure === 'personne' && filtres.personneId != null;

  const lignes = await db.query(
    `SELECT date_jour, personne_id, libelle, categorie_id, manifestation_id,
            SUM(minutes) AS minutes
       FROM (
         SELECT t.user_id AS personne_id, NULL AS libelle, t.minutes AS minutes,
                t.categorie_id, t.manifestation_id, t.date_jour
           FROM planning_taches t
          WHERE ${conditions}
         UNION ALL
         SELECT p.user_id AS personne_id, p.libelle AS libelle, p.minutes AS minutes,
                t.categorie_id, t.manifestation_id, t.date_jour
           FROM planning_participants p
           JOIN planning_taches t ON t.id = p.tache_id
          WHERE ${conditions}
       ) lignes
      ${restreindreALaPersonne ? 'WHERE lignes.personne_id = ?' : ''}
      GROUP BY date_jour, personne_id, libelle, categorie_id, manifestation_id`,
    // Les deux branches portent les mêmes conditions : leurs paramètres se
    // suivent donc deux fois, dans le même ordre. C'est le genre de duplication
    // qu'on ne recopie pas à la main.
    restreindreALaPersonne
      ? [...params, ...params, Number(filtres.personneId)]
      : [...params, ...params]
  );

  return lignes.map((l: any) => ({
    jour: versJour(l.date_jour),
    personneId: l.personne_id == null ? null : Number(l.personne_id),
    libelle: l.libelle ?? null,
    categorieId: l.categorie_id == null ? null : Number(l.categorie_id),
    manifestationId: l.manifestation_id == null ? null : Number(l.manifestation_id),
    minutes: Number(l.minutes),
  }));
}

/**
 * Combien de tâches, et non combien de contributions.
 *
 * `COUNT(*)` sur l'union compterait les lignes : une tâche à trois
 * contributeurs y vaudrait trois. La question « combien de tâches cette
 * semaine » se pose donc à la table des tâches, séparément.
 */
export async function compterTaches(
  filtres: FiltresRapport,
  perimetre: Perimetre
): Promise<number> {
  if (!perimetre.tout && perimetre.personnes.length === 0) return 0;

  const filtresTache: FiltresTaches = filtres.personneId
    ? { ...filtres, personneIds: [Number(filtres.personneId)] }
    : filtres;

  const { sql, params } = construireFiltres(filtresTache, perimetre);
  const ligne = await db.queryOne(
    `SELECT COUNT(*) as cnt FROM planning_taches t WHERE ${sql}`,
    params
  );
  return Number(ligne?.cnt ?? 0);
}

/** Les noms des personnes et des manifestations citées par les lignes. */
async function libelles(lignes: LigneDeTemps[]): Promise<{
  personnes: Map<number, string>;
  manifestations: Map<number, string>;
}> {
  const personnes = new Map<number, string>();
  const manifestations = new Map<number, string>();

  const personneIds = [...new Set(lignes.map((l) => l.personneId).filter((v): v is number => v != null))];
  if (personneIds.length > 0) {
    const trouvees = await db.query(
      `SELECT id, first_name, last_name FROM users WHERE id IN (${personneIds.map(() => '?').join(', ')})`,
      personneIds
    );
    for (const p of trouvees) personnes.set(Number(p.id), nomComplet(p));
  }

  const manifIds = [...new Set(lignes.map((l) => l.manifestationId).filter((v): v is number => v != null))];
  if (manifIds.length > 0) {
    const trouvees = await db.query(
      `SELECT id, title FROM manifestations WHERE id IN (${manifIds.map(() => '?').join(', ')})`,
      manifIds
    );
    for (const m of trouvees) manifestations.set(Number(m.id), m.title);
  }

  return { personnes, manifestations };
}

/**
 * Regroupe les lignes selon un axe, du plus long au plus court.
 *
 * Une clé `null` est une valeur en soi — « Sans catégorie », « Renforts non
 * nominatifs » — et non une ligne à écarter : l'escamoter ferait que la somme
 * des parts ne vaut plus le total, ce qu'un camembert rend visible aussitôt.
 */
function regrouper(
  lignes: LigneDeTemps[],
  cle: (l: LigneDeTemps) => string | number | null,
  nommer: (cle: string | number | null) => { id: number | null; libelle: string; couleur?: string }
): Part[] {
  const totaux = new Map<string, { brut: string | number | null; minutes: number }>();

  for (const ligne of lignes) {
    const valeur = cle(ligne);
    const index = valeur == null ? '\u0000null' : String(valeur);
    const courant = totaux.get(index) ?? { brut: valeur, minutes: 0 };
    courant.minutes += ligne.minutes;
    totaux.set(index, courant);
  }

  const total = [...totaux.values()].reduce((somme, v) => somme + v.minutes, 0);

  return [...totaux.values()]
    .map((v) => ({ ...nommer(v.brut), minutes: v.minutes, part: total > 0 ? v.minutes / total : null }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** Construit un rapport complet sur une période. */
export async function construireRapport(
  bornes: Bornes,
  filtres: Omit<FiltresRapport, 'debut' | 'fin'>,
  perimetre: Perimetre
): Promise<Rapport> {
  const complet: FiltresRapport = { ...filtres, debut: bornes.debut, fin: bornes.fin };
  const granularite = filtres.granularite ?? granularitePour(bornes);
  const typePeriode = filtres.typePeriode ?? granularite;

  const [lignes, taches, categories] = await Promise.all([
    lignesDeTemps(complet, perimetre),
    compterTaches(complet, perimetre),
    listerCategories(true),
  ]);

  const parId = new Map<number, Categorie>(categories.map((c) => [c.id, c]));
  const { personnes, manifestations } = await libelles(lignes);

  const minutes = lignes.reduce((somme, l) => somme + l.minutes, 0);
  const contributeurs = new Set(
    lignes.map((l) => (l.personneId != null ? `u${l.personneId}` : `l${l.libelle ?? ''}`))
  );

  // La série est bâtie pleine, puis remplie : une semaine sans saisie doit
  // valoir zéro sur le graphique, pas y manquer.
  const minutesParCle = new Map<string, number>();
  for (const ligne of lignes) {
    const cle = cleDePeriode(ligne.jour, granularite);
    minutesParCle.set(cle, (minutesParCle.get(cle) ?? 0) + ligne.minutes);
  }

  return {
    periode: {
      ...bornes,
      libelle: libelleDePeriode(typePeriode, bornes),
      jours: nombreDeJours(bornes),
      granularite,
      typePeriode,
    },
    mesure: filtres.mesure,
    total: { minutes, taches, personnes: contributeurs.size },
    parPeriode: periodesEntre(bornes.debut, bornes.fin, granularite).map((p) => ({
      cle: p.cle,
      libelle: p.libelle,
      libelleLong: p.libelleLong,
      debut: p.debut,
      fin: p.fin,
      minutes: minutesParCle.get(p.cle) ?? 0,
    })),
    parCategorie: regrouper(lignes, (l) => l.categorieId, (cle) => {
      if (cle == null) return { id: null, libelle: SANS_CATEGORIE };
      const categorie = parId.get(Number(cle));
      return {
        id: Number(cle),
        libelle: categorie?.nom ?? `Catégorie n° ${cle}`,
        couleur: categorie?.couleur,
      };
    }),
    parPersonne: regrouper(
      lignes,
      // Les renforts non nommés se rassemblent sous une seule entrée : les
      // distinguer par leur texte demanderait une normalisation que rien ne
      // garantit, pour une dimension qui est anonyme par définition.
      (l) => (l.personneId != null ? `u${l.personneId}` : 'anonymes'),
      (cle) => {
        const texte = String(cle ?? '');
        if (!texte.startsWith('u')) return { id: null, libelle: RENFORTS_ANONYMES };
        const id = Number(texte.slice(1));
        return { id, libelle: personnes.get(id) ?? `Personne n° ${id}` };
      }
    ),
    parManifestation: regrouper(lignes, (l) => l.manifestationId, (cle) => {
      if (cle == null) return { id: null, libelle: 'Hors manifestation' };
      const id = Number(cle);
      return { id, libelle: manifestations.get(id) ?? `Manifestation n° ${id}` };
    }),
  };
}

/**
 * L'écart entre un rapport et celui d'une autre période.
 *
 * Le pourcentage vaut `null` quand la référence est nulle : une progression
 * depuis zéro n'est pas « +∞ % », c'est une apparition, et c'est ce que le
 * client doit pouvoir dire.
 */
export function comparer(rapport: Rapport, reference: Rapport): Comparaison {
  const parCle = new Map<string, Part>();
  for (const part of reference.parCategorie) {
    parCle.set(part.id == null ? 'null' : String(part.id), part);
  }

  const cles = new Set<string>([
    ...rapport.parCategorie.map((p) => (p.id == null ? 'null' : String(p.id))),
    ...parCle.keys(),
  ]);

  const parCategorie = [...cles].map((cle) => {
    const courant = rapport.parCategorie.find((p) => (p.id == null ? 'null' : String(p.id)) === cle);
    const ancien = parCle.get(cle);
    const minutes = courant?.minutes ?? 0;
    const minutesReference = ancien?.minutes ?? 0;
    return {
      id: courant?.id ?? ancien?.id ?? null,
      libelle: courant?.libelle ?? ancien?.libelle ?? SANS_CATEGORIE,
      couleur: courant?.couleur ?? ancien?.couleur,
      minutes,
      minutesReference,
      ecart: minutes - minutesReference,
      pourcentage: minutesReference > 0
        ? Math.round(((minutes - minutesReference) / minutesReference) * 1000) / 10
        : null,
    };
  }).sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));

  return {
    reference,
    ecart: {
      minutes: rapport.total.minutes - reference.total.minutes,
      pourcentage: reference.total.minutes > 0
        ? Math.round(((rapport.total.minutes - reference.total.minutes) / reference.total.minutes) * 1000) / 10
        : null,
    },
    parCategorie,
  };
}
