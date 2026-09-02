import { db } from '../database';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';

/**
 * Ce que le fleurissement et le mobilier ont coûté, et où.
 *
 * Une implantation, c'est du matériel du parc **posé quelque part** : dix
 * rosiers dans la jardinière de la mairie, trois bancs le long de l'allée, une
 * corbeille au rond-point. Son coût est toujours le même produit — la quantité
 * posée, multipliée par le prix unitaire **figé au moment de la pose**.
 *
 * Ce prix figé est la clé de tout ce fichier. Le parc porte le prix
 * d'aujourd'hui, celui auquel on rachètera ; l'implantation porte celui qu'on a
 * réellement payé. Additionner les prix du parc donnerait la valeur de
 * remplacement du patrimoine — une autre question, parfaitement légitime, mais
 * qui n'est pas « qu'ai-je dépensé ». Toutes les fonctions d'ici lisent donc
 * `gse.purchase_price`, jamais `o.purchase_price`.
 *
 * Quatre lectures d'un même chiffre, parce que ce sont quatre questions :
 *
 *   **par espace**   ce qu'a coûté le parc Claude-Lemesle, ou telle rue ;
 *   **par groupe**   ce qu'a coûté *cette* jardinière, qui mêle trois variétés
 *                    à trois prix différents ;
 *   **par variété**  ce que coûtent les rosiers, tous massifs confondus ;
 *   **par année**    ce qu'a coûté le fleurissement 2026.
 *
 * **Ce qui n'a pas de prix ne vaut pas zéro.** Une ligne sans prix saisi est
 * comptée à part (`sans_prix`) et jamais fondue dans le total : un massif
 * chiffré à 40 € alors que la moitié n'est pas renseignée se lirait comme un
 * coût complet, et c'est ainsi qu'on présente un budget faux. L'écran peut
 * alors dire « 40 € sur 6 lignes, 4 sans prix », ce qui est la vérité.
 */

/**
 * Coût d'une ligne : la quantité posée, au prix figé.
 *
 * Écrit une seule fois et réemployé par toutes les requêtes — deux définitions
 * du coût finiraient par diverger, et deux écrans donneraient deux totaux pour
 * la même jardinière. Suppose l'alias `gse` sur `green_space_elements`.
 */
export const COUT_IMPLANTATION = `(COALESCE(gse.quantity, 1) * COALESCE(gse.purchase_price, 0))`;

/** Une ligne sans prix saisi : comptée, jamais chiffrée. */
const SANS_PRIX = `CASE WHEN gse.purchase_price IS NULL OR gse.purchase_price = 0 THEN 1 ELSE 0 END`;

/**
 * L'année d'une implantation : celle de la pose, à défaut celle de la saisie.
 *
 * `SUBSTR` sur une date est compris des deux moteurs — SQLite y voit la chaîne
 * qu'il stocke, MySQL convertit sa `DATE` en 'AAAA-MM-JJ' avant de couper.
 */
const ANNEE = `SUBSTR(COALESCE(gse.planting_date, gse.created_at), 1, 4)`;

const arrondi = (valeur: number): number => Math.round(valeur * 100) / 100;

/** Un axe d'analyse : un libellé, ce qu'il pèse, et ce qu'il tait. */
export interface LigneCout {
  cle: string | number | null;
  libelle: string;
  /** Unités posées — dix rosiers, et non dix lignes. */
  quantite: number;
  /** Lignes d'implantation, qui ne disent pas la même chose que la quantité. */
  lignes: number;
  cout: number;
  /** Lignes sans prix saisi, exclues du coût et signalées comme telles. */
  sans_prix: number;
}

export interface CoutEspace {
  green_space_id: number;
  total: number;
  quantite: number;
  lignes: number;
  sans_prix: number;
  par_groupe: LigneCout[];
  par_type: LigneCout[];
  par_variete: LigneCout[];
  par_annee: LigneCout[];
}

export interface SyntheseCouts {
  total: number;
  quantite: number;
  lignes: number;
  sans_prix: number;
  par_espace: LigneCout[];
  par_type_espace: LigneCout[];
  par_type_element: LigneCout[];
  par_variete: LigneCout[];
  par_annee: LigneCout[];
}

/** Ligne brute d'implantation, telle que la base la rend. */
interface ImplantationBrute {
  id: number;
  green_space_id: number;
  quantity: number | null;
  purchase_price: number | null;
  element_type: string | null;
  group_id: number | null;
  group_name: string | null;
  object_id: number | null;
  object_name: string | null;
  label: string;
  annee: string | null;
}

/** Quantité d'une ligne : jamais négative, et une pose vaut au moins un. */
const quantiteDe = (ligne: { quantity?: number | null }): number =>
  Math.max(0, Number(ligne.quantity ?? 1) || 0);

/** Prix figé d'une ligne, ou zéro quand il n'a pas été saisi. */
const prixDe = (ligne: { purchase_price?: number | null }): number =>
  Number(ligne.purchase_price ?? 0) || 0;

/**
 * Regroupe des implantations sur un axe.
 *
 * L'ordre du résultat est celui du coût décroissant : sur une jardinière de
 * douze variétés, ce qu'on cherche est ce qui pèse, pas l'ordre alphabétique.
 */
function regrouper(
  lignes: ImplantationBrute[],
  cle: (ligne: ImplantationBrute) => { cle: string | number | null; libelle: string }
): LigneCout[] {
  const parCle = new Map<string, LigneCout>();

  for (const ligne of lignes) {
    const axe = cle(ligne);
    const index = String(axe.cle ?? '__sans__');
    const agregat = parCle.get(index) ?? {
      cle: axe.cle ?? null,
      libelle: axe.libelle,
      quantite: 0,
      lignes: 0,
      cout: 0,
      sans_prix: 0,
    };

    const quantite = quantiteDe(ligne);
    const prix = prixDe(ligne);

    agregat.quantite += quantite;
    agregat.lignes += 1;
    agregat.cout += quantite * prix;
    if (prix <= 0) agregat.sans_prix += 1;

    parCle.set(index, agregat);
  }

  return trier([...parCle.values()].map((ligne) => ({ ...ligne, cout: arrondi(ligne.cout) })));
}

/** Le plus cher d'abord, puis l'ordre alphabétique français. */
const trier = (lignes: LigneCout[]): LigneCout[] =>
  lignes.sort((a, b) => b.cout - a.cout || a.libelle.localeCompare(b.libelle, 'fr'));

/** Implantations d'un espace vert, avec de quoi les nommer sur chaque axe. */
async function implantationsDe(greenSpaceId: number | string): Promise<ImplantationBrute[]> {
  return db.query(
    `SELECT gse.id, gse.green_space_id, gse.quantity, gse.purchase_price,
            gse.element_type, gse.group_id, gse.object_id, gse.label,
            g.name as group_name, o.name as object_name,
            ${ANNEE} as annee
     FROM green_space_elements gse
     LEFT JOIN green_space_groups g ON g.id = gse.group_id
     LEFT JOIN objects o ON o.id = gse.object_id
     WHERE gse.green_space_id = ?`,
    [greenSpaceId]
  );
}

/**
 * Ce qu'un espace vert a coûté, vu sous ses quatre angles.
 *
 * Rend toujours une structure complète, même vide : un écran qui disparaît se
 * lit comme une panne, quand « aucun coût saisi » est une réponse.
 */
export async function coutEspace(greenSpaceId: number | string): Promise<CoutEspace> {
  const lignes = await implantationsDe(greenSpaceId);

  return {
    green_space_id: Number(greenSpaceId),
    total: arrondi(lignes.reduce((somme, l) => somme + quantiteDe(l) * prixDe(l), 0)),
    quantite: lignes.reduce((somme, l) => somme + quantiteDe(l), 0),
    lignes: lignes.length,
    sans_prix: lignes.filter((l) => prixDe(l) <= 0).length,

    // Une jardinière porte un nom ; ce qui n'est dans aucun groupe reste
    // visible sous « Hors groupe », sans quoi le détail ne totaliserait plus
    // l'espace et l'écart serait inexplicable.
    par_groupe: regrouper(lignes, (l) => ({
      cle: l.group_id,
      libelle: l.group_name || 'Hors groupe',
    })),
    par_type: regrouper(lignes, (l) => ({
      cle: l.element_type,
      libelle: l.element_type || 'autre',
    })),
    // La variété, c'est le matériel du parc. Une implantation libre — un arbre
    // centenaire que personne n'a acheté — n'en a pas, et se range sous son
    // propre libellé plutôt que dans un fourre-tout.
    par_variete: regrouper(lignes, (l) => ({
      cle: l.object_id,
      libelle: l.object_name || l.label || 'Sans matériel du parc',
    })),
    par_annee: regrouper(lignes, (l) => ({
      cle: l.annee,
      libelle: l.annee || 'Sans date',
    })),
  };
}

/**
 * Ce que coûte l'ensemble des espaces verts.
 *
 * `espaceIds` restreint la synthèse aux espaces demandés — ceux que l'écran a
 * filtrés, ou ceux que l'appelant a le droit de voir. Une liste vide
 * explicitement passée n'est pas « tout » : c'est rien, et rendre le total
 * général à sa place ferait fuir des chiffres qu'on venait d'exclure.
 */
export async function syntheseCouts(options?: {
  espaceIds?: Array<number | string>;
}): Promise<SyntheseCouts> {
  const vide: SyntheseCouts = {
    total: 0,
    quantite: 0,
    lignes: 0,
    sans_prix: 0,
    par_espace: [],
    par_type_espace: [],
    par_type_element: [],
    par_variete: [],
    par_annee: [],
  };

  const ids = options?.espaceIds?.map(Number).filter((n) => Number.isFinite(n));
  if (ids && ids.length === 0) return vide;

  const restriction = ids ? ` AND gse.green_space_id IN (${ids.map(() => '?').join(', ')})` : '';
  const params = ids ?? [];

  const axe = (cle: string, libelle: string, jointures: string, groupBy: string) => `
    SELECT ${cle} as cle, ${libelle} as libelle,
           COALESCE(SUM(COALESCE(gse.quantity, 1)), 0) as quantite,
           COUNT(*) as lignes,
           COALESCE(SUM(${COUT_IMPLANTATION}), 0) as cout,
           COALESCE(SUM(${SANS_PRIX}), 0) as sans_prix
    FROM green_space_elements gse
    ${jointures}
    WHERE 1 = 1${restriction}
    GROUP BY ${groupBy}
  `;

  const jointureEspace = 'JOIN green_spaces gs ON gs.id = gse.green_space_id';

  const [parEspace, parTypeEspace, parTypeElement, parVariete, parAnnee, totaux] =
    await Promise.all([
      db.query(
        axe('gse.green_space_id', 'gs.name', jointureEspace, 'gse.green_space_id, gs.name'),
        params
      ),
      db.query(axe('gs.space_type', 'gs.space_type', jointureEspace, 'gs.space_type'), params),
      db.query(axe('gse.element_type', 'gse.element_type', '', 'gse.element_type'), params),
      db.query(
        axe(
          'gse.object_id',
          'COALESCE(o.name, gse.label)',
          'LEFT JOIN objects o ON o.id = gse.object_id',
          'gse.object_id, COALESCE(o.name, gse.label)'
        ),
        params
      ),
      db.query(axe(ANNEE, ANNEE, '', ANNEE), params),
      db.queryOne(
        `SELECT COALESCE(SUM(${COUT_IMPLANTATION}), 0) as total,
                COALESCE(SUM(COALESCE(gse.quantity, 1)), 0) as quantite,
                COUNT(*) as lignes,
                COALESCE(SUM(${SANS_PRIX}), 0) as sans_prix
         FROM green_space_elements gse
         WHERE 1 = 1${restriction}`,
        params
      ),
    ]);

  return {
    total: arrondi(Number(totaux?.total ?? 0)),
    quantite: Number(totaux?.quantite ?? 0),
    lignes: Number(totaux?.lignes ?? 0),
    sans_prix: Number(totaux?.sans_prix ?? 0),
    par_espace: normaliser(parEspace, 'Espace supprimé'),
    par_type_espace: normaliser(parTypeEspace, 'Sans type'),
    par_type_element: normaliser(parTypeElement, 'autre'),
    par_variete: normaliser(parVariete, 'Sans matériel du parc'),
    par_annee: normaliser(parAnnee, 'Sans date'),
  };
}

/** Met une ligne agrégée par SQL à la forme rendue par `regrouper`. */
function normaliser(lignes: any[], libelleParDefaut: string): LigneCout[] {
  return trier(
    lignes.map((ligne) => ({
      cle: ligne.cle ?? null,
      libelle:
        ligne.libelle != null && String(ligne.libelle) !== ''
          ? String(ligne.libelle)
          : libelleParDefaut,
      quantite: Number(ligne.quantite ?? 0),
      lignes: Number(ligne.lignes ?? 0),
      cout: arrondi(Number(ligne.cout ?? 0)),
      sans_prix: Number(ligne.sans_prix ?? 0),
    }))
  );
}

/**
 * Prix unitaire à retenir pour du matériel du parc.
 *
 * Les deux colonnes du parc ne disent pas la même chose, et les confondre
 * fausserait tous les totaux :
 *
 *   `unit_cost`       ce que vaut **une** unité — 2,50 € le rosier. Saisi
 *                     précisément pour les lots, il est la bonne réponse dès
 *                     qu'il est renseigné.
 *   `purchase_price`  ce que la fiche a coûté à l'achat. Sur un exemplaire —
 *                     un banc, une fontaine — c'est exactement la dépense ; sur
 *                     un lot, ce peut être la facture entière, d'où le second
 *                     rang.
 *
 * Zéro n'est pas un prix : mieux vaut ne rien figer, et le dire, que d'inscrire
 * un coût inventé qui se retrouverait ensuite dans un bilan.
 */
export function prixUnitaireDuParc(objet: {
  unit_cost?: number | null;
  purchase_price?: number | null;
}): number | null {
  const unitaire = Number(objet.unit_cost ?? 0);
  if (unitaire > 0) return unitaire;
  const achat = Number(objet.purchase_price ?? 0);
  return achat > 0 ? achat : null;
}

/** Où un matériel du parc est déjà posé, et en quelle quantité. */
export interface ImplantationsObjet {
  quantite: number;
  espaces: number;
}

/**
 * Ce qui est déjà implanté, matériel par matériel.
 *
 * Sert au moment de choisir dans le parc : savoir que trente rosiers sont déjà
 * en terre, répartis sur quatre espaces, évite d'en commander cent « pour être
 * sûr ». Rendu en `Map` et demandé en une fois — une requête par ligne de
 * catalogue ferait vingt allers-retours pour un seul écran.
 */
export async function implantationsParObjet(
  objectIds: Array<number | string>
): Promise<Map<number, ImplantationsObjet>> {
  const resultat = new Map<number, ImplantationsObjet>();
  const identifiants = objectIds.map(Number).filter((n) => Number.isFinite(n));
  if (identifiants.length === 0) return resultat;

  const lignes = await grouperEnfants(
    (marqueurs) => `
      SELECT gse.object_id,
             COALESCE(SUM(COALESCE(gse.quantity, 1)), 0) as quantite,
             COUNT(DISTINCT gse.green_space_id) as espaces
      FROM green_space_elements gse
      WHERE gse.object_id IN (${marqueurs})
      GROUP BY gse.object_id
    `,
    identifiants,
    'object_id'
  );

  for (const id of new Set(identifiants)) {
    const ligne = enfantsDe<any>(lignes, id)[0];
    resultat.set(id, {
      quantite: Number(ligne?.quantite ?? 0),
      espaces: Number(ligne?.espaces ?? 0),
    });
  }

  return resultat;
}
