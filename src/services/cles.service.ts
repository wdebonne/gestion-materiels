import crypto from 'crypto';
import { db } from '../database';
import { grouperEnfants, enfantsDe } from '../utils/batchQuery';

/**
 * Clés, badges et trousseaux : stock, ouvrants, composition et détention.
 *
 * Tout ce module repose sur un parti pris posé par la migration 024 : une clé,
 * un badge, un trousseau **sont des `objects`**. Il n'y a donc pas de table
 * « clés » à tenir en parallèle du parc, et aucune fonction ici ne crée ni ne
 * supprime de matériel — elle décrit seulement ce que le parc ne sait pas dire
 * tout seul : ce qu'une clé ouvre, ce qu'elle a coûté, et chez qui elle est.
 *
 * Deux invariants gouvernent le reste :
 *
 *   **Le prix d'un lot ne bouge jamais.** `valeurDuStock` additionne les lots
 *   tels qu'ils ont été payés. Le coût moyen qu'elle renvoie est une commodité
 *   d'affichage, jamais une source : recalculer un prix unique et l'écrire
 *   partout effacerait précisément ce qu'on cherchait à savoir.
 *
 *   **La détention est une ligne ouverte.** Une attribution dont
 *   `restitution_on` est nul est en cours ; toutes les autres sont l'historique.
 *   Une clé ne peut donc pas être « chez deux personnes » sans que cela se voie,
 *   et « par qui est-elle passée » se lit sans journal supplémentaire.
 */

/** Ce qu'un trousseau ou une clé peut avoir comme détenteur. */
export type TypeDetenteur = 'user' | 'service' | 'ouvrant' | 'externe';

export const TYPES_DETENTEUR: readonly TypeDetenteur[] = ['user', 'service', 'ouvrant', 'externe'];

export interface StockCle {
  /** Somme des quantités de tous les lots. */
  total: number;
  /** Exemplaires engagés dans des trousseaux. */
  enTrousseaux: number;
  /** Exemplaires remis seuls et non restitués. */
  attribueesSeules: number;
  /** Ce qui reste au coffre. Jamais négatif. */
  disponibles: number;
}

export interface ValeurCle {
  /** Valeur d'achat cumulée, chaque lot à son prix. */
  valeur: number;
  /** Quantité couverte par un lot dont le prix est connu. */
  quantiteValorisee: number;
  /** Indicatif : valeur / quantité valorisée. Zéro si aucun prix connu. */
  coutMoyen: number;
}

const nombre = (valeur: unknown): number => {
  const n = Number(valeur);
  return Number.isFinite(n) ? n : 0;
};

const entierPositif = (valeur: unknown): number => Math.max(0, Math.trunc(nombre(valeur)));

// ======================== STOCK ET VALEUR ========================

/**
 * Ce que devient la quantité d'une clé : détenue, engagée, disponible.
 *
 * `disponibles` est bridé à zéro plutôt que de passer en négatif. Un négatif
 * serait la trace d'une saisie incohérente — plus de clés en circulation que
 * de clés fabriquées — mais l'afficher tel quel dans un écran de prêt ferait
 * croire à une dette, là où le bon message est « il n'en reste plus ».
 */
export async function stockDeLaCle(objectId: number): Promise<StockCle> {
  const [lots, trousseaux, seules] = await Promise.all([
    db.queryOne('SELECT COALESCE(SUM(quantity), 0) AS total FROM cle_lots WHERE object_id = ?', [
      objectId,
    ]),
    db.queryOne(
      'SELECT COALESCE(SUM(quantity), 0) AS total FROM trousseau_composants WHERE object_id = ?',
      [objectId]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(quantity), 0) AS total
         FROM cle_attributions
        WHERE object_id = ? AND restitution_on IS NULL`,
      [objectId]
    ),
  ]);

  const total = entierPositif(lots?.total);
  const enTrousseaux = entierPositif(trousseaux?.total);
  const attribueesSeules = entierPositif(seules?.total);

  return {
    total,
    enTrousseaux,
    attribueesSeules,
    disponibles: Math.max(0, total - enTrousseaux - attribueesSeules),
  };
}

/**
 * Valeur du stock, chaque lot à son prix.
 *
 * Les lots sans prix — le « stock initial » d'une clé déjà en service — sont
 * comptés dans la quantité mais pas dans la valeur, et `quantiteValorisee` dit
 * sur quelle part le chiffre porte. Les noyer dans la moyenne en leur prêtant
 * un prix moyen reviendrait à inventer le montant qu'on avoue ne pas connaître.
 */
export async function valeurDuStock(objectId: number): Promise<ValeurCle> {
  const ligne = await db.queryOne(
    `SELECT COALESCE(SUM(quantity * unit_price), 0) AS valeur,
            COALESCE(SUM(CASE WHEN unit_price IS NULL THEN 0 ELSE quantity END), 0) AS quantite
       FROM cle_lots
      WHERE object_id = ?`,
    [objectId]
  );

  const valeur = nombre(ligne?.valeur);
  const quantiteValorisee = entierPositif(ligne?.quantite);

  return {
    valeur,
    quantiteValorisee,
    coutMoyen: quantiteValorisee > 0 ? valeur / quantiteValorisee : 0,
  };
}

/**
 * Réaligne `objects.quantity_total` et `objects.unit_cost` sur les lots.
 *
 * À appeler après toute écriture de lot. Le reste de l'application — la
 * disponibilité du parc, les manifestations, l'amortissement — lit ces deux
 * colonnes et ne connaît pas `cle_lots` : sans ce recalage, une refabrication
 * n'apparaîtrait nulle part ailleurs que dans cet écran.
 *
 * `quantity_total` n'est écrit que sur un **lot**. Un exemplaire unique n'a pas
 * de quantité — la sienne vaut toujours 1 — et lui en inscrire une serait un
 * chiffre que rien ne lit et que tout contredit : `lotParc.service.ts` ne
 * consulte cette colonne que pour un lot. Le cas se présente quand des lots ont
 * été saisis sur un matériel dont la nature n'a pas encore été corrigée ; la
 * valeur, elle, reste juste et continue d'être tenue à jour.
 */
export async function recalculerDepuisLots(objectId: number): Promise<StockCle> {
  const stock = await stockDeLaCle(objectId);
  const { coutMoyen } = await valeurDuStock(objectId);

  const materiel = await db.queryOne<{ material_type: string }>(
    'SELECT material_type FROM objects WHERE id = ?',
    [objectId]
  );

  if (materiel?.material_type === 'lot') {
    await db.execute('UPDATE objects SET quantity_total = ?, unit_cost = ? WHERE id = ?', [
      stock.total,
      coutMoyen,
      objectId,
    ]);
  } else {
    // `unit_cost` garde son sens sur un exemplaire unique : c'est sa valeur de
    // remplacement (voir la migration 013).
    await db.execute('UPDATE objects SET unit_cost = ? WHERE id = ?', [coutMoyen, objectId]);
  }

  return stock;
}

// ======================== CE QUE ÇA OUVRE ========================

/**
 * Ce qu'une clé ouvre, site par site.
 *
 * Une ligne portant `site_id` est un **passe** : elle vaut pour tout le site, y
 * compris les portes créées après coup. Une ligne portant `ouvrant_id` ne vaut
 * que pour cette porte. Les deux formes cohabitent sur une même clé.
 */
export async function ouvrantsDeLaCle(objectId: number): Promise<any[]> {
  return db.query(
    `SELECT co.id, co.site_id, co.ouvrant_id,
            s.name AS site_name, s.code AS site_code,
            o.name AS ouvrant_name, o.code AS ouvrant_code,
            CASE WHEN co.site_id IS NOT NULL THEN 1 ELSE 0 END AS est_passe
       FROM cle_ouvre co
       LEFT JOIN cle_sites s ON s.id = co.site_id
       LEFT JOIN cle_ouvrants o ON o.id = co.ouvrant_id
       LEFT JOIN cle_sites so ON so.id = o.site_id
      WHERE co.object_id = ?
      ORDER BY COALESCE(s.name, so.name), o.name`,
    [objectId]
  );
}

/** Les clés qui ouvrent une porte donnée, passes du site compris. */
export async function clesQuiOuvrent(ouvrantId: number): Promise<any[]> {
  return db.query(
    `SELECT DISTINCT ob.id, ob.name, ob.reference, ob.quantity_total
       FROM cle_ouvre co
       JOIN objects ob ON ob.id = co.object_id
       LEFT JOIN cle_ouvrants ouv ON ouv.id = ?
      WHERE co.ouvrant_id = ?
         OR co.site_id = ouv.site_id
      ORDER BY ob.name`,
    [ouvrantId, ouvrantId]
  );
}

/**
 * Remplace d'un bloc ce qu'une clé ouvre.
 *
 * Remplacement et non fusion : l'écran présente la liste entière, et retirer une
 * porte s'y fait en la décochant. Une fusion laisserait cette porte en place, et
 * l'utilisateur croirait avoir retiré un accès qu'il aurait conservé.
 */
export async function definirOuvrants(
  objectId: number,
  entrees: Array<{ siteId?: number | null; ouvrantId?: number | null }>
): Promise<void> {
  await db.execute('DELETE FROM cle_ouvre WHERE object_id = ?', [objectId]);

  for (const entree of entrees) {
    const siteId = entree.siteId ? Number(entree.siteId) : null;
    const ouvrantId = entree.ouvrantId ? Number(entree.ouvrantId) : null;

    // Exactement un des deux, faute de contrainte CHECK portable (voir la
    // migration 024). Une entrée qui porte les deux, ou aucun, est ignorée
    // plutôt que d'écrire une ligne dont personne ne saurait dire le sens.
    if ((siteId === null) === (ouvrantId === null)) continue;

    await db.execute('INSERT INTO cle_ouvre (object_id, site_id, ouvrant_id) VALUES (?, ?, ?)', [
      objectId,
      siteId,
      ouvrantId,
    ]);
  }
}

// ======================== COMPOSITION ========================

/**
 * De quoi un trousseau est fait, et ce que chaque élément ouvre.
 *
 * Les ouvrants sont chargés en une requête pour toute la composition plutôt
 * qu'une par clé : un trousseau de quinze clés ferait seize allers-retours pour
 * afficher un encart.
 */
export async function compositionDuTrousseau(trousseauId: number): Promise<any[]> {
  const composants = await db.query(
    `SELECT tc.id, tc.object_id, tc.quantity, tc.notes,
            ob.name, ob.reference, ob.image, ob.material_type,
            sc.name AS subcategory_name
       FROM trousseau_composants tc
       JOIN objects ob ON ob.id = tc.object_id
       LEFT JOIN subcategories sc ON sc.id = ob.subcategory_id
      WHERE tc.trousseau_id = ?
      ORDER BY ob.name`,
    [trousseauId]
  );

  if (composants.length === 0) return [];

  const ouvrants = await grouperEnfants<any>(
    (marqueurs) => `
      SELECT co.object_id,
             s.name AS site_name,
             o.name AS ouvrant_name,
             so.name AS ouvrant_site_name,
             CASE WHEN co.site_id IS NOT NULL THEN 1 ELSE 0 END AS est_passe
        FROM cle_ouvre co
        LEFT JOIN cle_sites s ON s.id = co.site_id
        LEFT JOIN cle_ouvrants o ON o.id = co.ouvrant_id
        LEFT JOIN cle_sites so ON so.id = o.site_id
       WHERE co.object_id IN (${marqueurs})`,
    composants.map((c: any) => c.object_id),
    'object_id'
  );

  return composants.map((composant: any) => ({
    ...composant,
    ouvre: enfantsDe(ouvrants, composant.object_id),
  }));
}

/** Les trousseaux qui contiennent une clé donnée — la question inverse. */
export async function trousseauxContenant(objectId: number): Promise<any[]> {
  return db.query(
    `SELECT ob.id, ob.name, ob.reference, tc.quantity
       FROM trousseau_composants tc
       JOIN objects ob ON ob.id = tc.trousseau_id
      WHERE tc.object_id = ?
      ORDER BY ob.reference, ob.name`,
    [objectId]
  );
}

// ======================== DÉTENTION ========================

const CHAMPS_DETENTEUR = `
  a.holder_type, a.holder_user_id, a.holder_service_id, a.holder_ouvrant_id, a.holder_label,
  u.first_name AS holder_first_name, u.last_name AS holder_last_name, u.email AS holder_email,
  sv.name AS holder_service_name,
  ouv.name AS holder_ouvrant_name, st.name AS holder_site_name`;

const JOINTURES_DETENTEUR = `
  LEFT JOIN users u ON u.id = a.holder_user_id
  LEFT JOIN services sv ON sv.id = a.holder_service_id
  LEFT JOIN cle_ouvrants ouv ON ouv.id = a.holder_ouvrant_id
  LEFT JOIN cle_sites st ON st.id = ouv.site_id`;

/** Qui détient l'objet en ce moment, ou `null` s'il est au coffre. */
export async function detenteurActuel(objectId: number): Promise<any | null> {
  return db.queryOne(
    `SELECT a.id, a.quantity, a.remise_on, a.notes, ${CHAMPS_DETENTEUR}
       FROM cle_attributions a
       ${JOINTURES_DETENTEUR}
      WHERE a.object_id = ? AND a.restitution_on IS NULL
      ORDER BY a.remise_on DESC, a.id DESC`,
    [objectId]
  );
}

/**
 * Tout le passage de l'objet, du plus récent au plus ancien.
 *
 * C'est la réponse littérale à « par qui est-elle passée » : la même table que
 * la détention courante, sans le filtre sur la restitution.
 */
export async function historique(objectId: number): Promise<any[]> {
  return db.query(
    `SELECT a.id, a.quantity, a.remise_on, a.restitution_on, a.etat_retour, a.notes,
            ${CHAMPS_DETENTEUR},
            rb.first_name AS remise_by_first_name, rb.last_name AS remise_by_last_name,
            sb.first_name AS restitution_by_first_name, sb.last_name AS restitution_by_last_name
       FROM cle_attributions a
       ${JOINTURES_DETENTEUR}
       LEFT JOIN users rb ON rb.id = a.remise_by
       LEFT JOIN users sb ON sb.id = a.restitution_by
      WHERE a.object_id = ?
      ORDER BY a.remise_on DESC, a.id DESC`,
    [objectId]
  );
}

/** Détentions en cours de plusieurs objets, en une requête. */
export async function detenteursDe(objectIds: number[]): Promise<Map<any, any[]>> {
  return grouperEnfants<any>(
    (marqueurs) => `
      SELECT a.object_id, a.quantity, a.remise_on, ${CHAMPS_DETENTEUR}
        FROM cle_attributions a
        ${JOINTURES_DETENTEUR}
       WHERE a.object_id IN (${marqueurs}) AND a.restitution_on IS NULL`,
    objectIds,
    'object_id'
  );
}

// ======================== NUMÉROTATION ========================

/**
 * Prochain numéro libre pour un préfixe, au format `TST001`.
 *
 * Le numéro proposé reste modifiable à la création : c'est une commodité, pas
 * une séquence faisant autorité. On lit donc le plus grand numéro **existant**
 * plutôt que de tenir un compteur — un compteur et une référence saisie à la
 * main finiraient par diverger, et c'est la référence qui est écrite sur
 * l'étiquette.
 */
export async function prochainNumero(prefixe: string): Promise<string> {
  const propre = String(prefixe || '').trim().toUpperCase();
  if (!propre) return '';

  const lignes = await db.query<{ reference: string }>(
    'SELECT reference FROM objects WHERE reference LIKE ?',
    [`${propre}%`]
  );

  const motif = new RegExp(`^${propre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
  let plusGrand = 0;
  let largeur = 3;

  for (const ligne of lignes) {
    const trouve = motif.exec(String(ligne.reference || '').trim().toUpperCase());
    if (!trouve) continue;
    const valeur = Number(trouve[1]);
    if (valeur > plusGrand) {
      plusGrand = valeur;
      largeur = Math.max(largeur, trouve[1].length);
    }
  }

  return `${propre}${String(plusGrand + 1).padStart(largeur, '0')}`;
}

// ======================== JETON PUBLIC ========================

/**
 * Alphabet sans caractère ambigu : ni `O`/`0`, ni `I`/`1`, ni `L`.
 *
 * Le jeton finit imprimé sur une étiquette, et quelqu'un le recopiera un jour à
 * la main parce que le QR sera rayé. Un `0` lu `O` renvoie alors vers rien.
 */
const ALPHABET_JETON = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Longueur du jeton : 8 caractères sur 31 symboles, soit ~40 bits. */
const LONGUEUR_JETON = 8;

/**
 * Tire un jeton court et imprévisible.
 *
 * Le rejet des valeurs au-delà du plus grand multiple de l'alphabet évite le
 * biais qu'introduirait un simple modulo : sans lui les premières lettres
 * sortiraient un peu plus souvent, ce qui réduit l'entropie réelle.
 */
function tirerJeton(): string {
  const limite = Math.floor(256 / ALPHABET_JETON.length) * ALPHABET_JETON.length;
  let jeton = '';

  while (jeton.length < LONGUEUR_JETON) {
    for (const octet of crypto.randomBytes(LONGUEUR_JETON * 2)) {
      if (octet >= limite) continue;
      jeton += ALPHABET_JETON[octet % ALPHABET_JETON.length];
      if (jeton.length === LONGUEUR_JETON) break;
    }
  }

  return jeton;
}

/**
 * Jeton public d'un objet, créé à la première demande.
 *
 * Créé paresseusement plutôt qu'à la création du matériel : un parc déjà saisi
 * n'a pas de jeton, et imprimer une étiquette ne doit pas commencer par une
 * migration de rattrapage. La collision est traitée en réessayant — à 40 bits
 * elle est improbable, mais « improbable » n'est pas « impossible », et la
 * colonne est UNIQUE.
 */
export async function jetonPour(objectId: number): Promise<string> {
  const existant = await db.queryOne<{ token: string }>(
    'SELECT token FROM cle_jetons WHERE object_id = ?',
    [objectId]
  );
  if (existant?.token) return existant.token;

  for (let essai = 0; essai < 5; essai += 1) {
    const jeton = tirerJeton();
    try {
      await db.execute('INSERT INTO cle_jetons (object_id, token) VALUES (?, ?)', [
        objectId,
        jeton,
      ]);
      return jeton;
    } catch {
      // Course entre deux impressions simultanées, ou collision de tirage :
      // si la ligne existe maintenant, c'est elle qui fait foi.
      const pose = await db.queryOne<{ token: string }>(
        'SELECT token FROM cle_jetons WHERE object_id = ?',
        [objectId]
      );
      if (pose?.token) return pose.token;
    }
  }

  throw new Error("Impossible d'attribuer un jeton public à ce matériel");
}

/** L'objet désigné par un jeton public, ou `null`. */
export async function objetDuJeton(token: string): Promise<any | null> {
  const propre = String(token || '').trim().toUpperCase();
  if (!propre || propre.length > 32) return null;

  return db.queryOne(
    `SELECT ob.id, ob.name, ob.reference, ob.category_id, ob.subcategory_id,
            ob.material_type, ob.image
       FROM cle_jetons j
       JOIN objects ob ON ob.id = j.object_id
      WHERE j.token = ?`,
    [propre]
  );
}

export default {
  stockDeLaCle,
  valeurDuStock,
  recalculerDepuisLots,
  ouvrantsDeLaCle,
  clesQuiOuvrent,
  definirOuvrants,
  compositionDuTrousseau,
  trousseauxContenant,
  detenteurActuel,
  detenteursDe,
  historique,
  prochainNumero,
  jetonPour,
  objetDuJeton,
};
