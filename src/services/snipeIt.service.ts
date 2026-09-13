import { db } from '../database';
import { recalculerDepuisLots } from './cles.service';
import { cleDeSite, lireLibelle, type LectureLibelle } from './snipeItLibelle.service';

/**
 * Reprise d'un inventaire tenu dans Snipe-IT.
 *
 * Snipe-IT distingue les mêmes natures que nous, sous d'autres noms : un
 * **Component** est une pièce en quantité — notre clé ; un **Asset** est un
 * exemplaire identifié par son `asset_tag` — notre trousseau ; et **sortir un
 * composant vers un actif** est exactement notre `trousseau_composants`.
 *
 * Le module tient en deux temps, et c'est délibéré :
 *
 *   `analyser` ne lit que Snipe-IT et n'écrit rien. Il rend un **plan** que
 *   l'écran présente ligne à ligne, avec ce qu'il compte créer et ce qu'il a
 *   déduit d'un libellé. Un import d'inventaire est irréversible en pratique
 *   — personne ne supprime deux cents fiches à la main pour recommencer.
 *
 *   `appliquer` écrit le plan que l'utilisateur a validé, et **seulement** ce
 *   plan : il ne relit pas Snipe-IT et ne redéduit rien. Ce que l'écran a
 *   montré est ce qui est écrit.
 *
 * L'ensemble est rejouable. `cle_import_snipeit` retient ce que chaque
 * enregistrement distant est devenu ici, si bien qu'un second passage met à
 * jour au lieu de dupliquer — ce qui compte, parce qu'une reprise se fait
 * rarement du premier coup.
 */

export interface ConfigSnipeIt {
  baseUrl: string;
  token: string;
}

/** Une clé telle que l'import la propose. */
export interface PropositionCle {
  sourceId: number;
  nom: string;
  modele: string | null;
  serie: string | null;
  quantite: number;
  prixUnitaire: number | null;
  dateAchat: string | null;
  categorieSnipe: string | null;
  /** Ce que la lecture du libellé propose, et avec quelle assurance. */
  lecture: LectureLibelle;
  /** Identifiant local si cette clé a déjà été importée. */
  objectIdExistant: number | null;
}

export interface PropositionTrousseau {
  sourceId: number;
  inventaire: string;
  nom: string;
  serie: string | null;
  /** Identifiants Snipe-IT des composants sortis vers cet actif. */
  composants: number[];
  detenteur: { type: string; nom: string } | null;
  dateRemise: string | null;
  objectIdExistant: number | null;
}

export interface PlanImport {
  cles: PropositionCle[];
  trousseaux: PropositionTrousseau[];
  /** Sites déduits des libellés, dédoublonnés, tels qu'ils seront créés. */
  sites: string[];
  avertissements: string[];
}

// ======================== CLIENT ========================

/** Snipe-IT plafonne ses pages ; 100 tient largement sous toutes les limites. */
const TAILLE_PAGE = 100;

/**
 * Borne du nombre de pages, pour qu'une pagination qui ne converge pas
 * — un `total` incohérent, une instance qui renvoie toujours la même page —
 * s'arrête au lieu de tourner jusqu'au délai d'expiration du serveur.
 */
const PAGES_MAX = 200;

function racine(config: ConfigSnipeIt): string {
  const base = String(config.baseUrl || '').trim().replace(/\/+$/, '');
  const avecSchema = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  // L'utilisateur colle aussi bien « https://parc.ville.fr » que
  // « https://parc.ville.fr/api/v1 » : les deux doivent marcher.
  return avecSchema.replace(/\/api\/v1$/i, '');
}

async function lire<T = any>(
  config: ConfigSnipeIt,
  chemin: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const url = new URL(`${racine(config)}/api/v1${chemin}`);
  for (const [cle, valeur] of Object.entries(params)) {
    url.searchParams.set(cle, String(valeur));
  }

  const reponse = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  const texte = await reponse.text().catch(() => '');

  if (!reponse.ok) {
    throw new ErreurSnipeIt(diagnostiquer(reponse.status, texte, url.toString()), reponse.status);
  }

  try {
    return JSON.parse(texte) as T;
  } catch {
    // Un 200 qui n'est pas du JSON, c'est presque toujours un portail
    // d'authentification — SSO, mot de passe HTTP — placé devant l'application.
    throw new ErreurSnipeIt(
      estHtml(texte)
        ? `L'adresse ${url.origin} renvoie une page web au lieu de données. ` +
            `Un portail d'authentification est probablement placé devant Snipe-IT : ` +
            `l'API doit être joignable sans passer par lui.`
        : `Snipe-IT a renvoyé une réponse illisible sur ${chemin}.`,
      reponse.status
    );
  }
}

/** Erreur portant le code HTTP, pour que l'appelant puisse décider de réessayer. */
export class ErreurSnipeIt extends Error {
  constructor(
    message: string,
    public readonly statut: number
  ) {
    super(message);
    this.name = 'ErreurSnipeIt';
  }
}

function estHtml(corps: string): boolean {
  return /^\s*<(!doctype|html)/i.test(corps);
}

/**
 * Traduit une réponse d'erreur en quelque chose d'actionnable.
 *
 * La version précédente recopiait 200 caractères du corps dans le message :
 * sur une 404 d'Apache, l'utilisateur recevait du HTML brut — « <!DOCTYPE HTML
 * PUBLIC… » — qui ne lui disait pas quoi corriger. Or ces erreurs ont presque
 * toujours la même poignée de causes, et chacune a son geste.
 */
function diagnostiquer(statut: number, corps: string, url: string): string {
  const html = estHtml(corps);

  if (statut === 404 && html) {
    // Le serveur web répond, mais rien ne route vers Snipe-IT : c'est l'adresse
    // qui est en cause, pas le jeton.
    return (
      `L'adresse ne mène pas à l'API Snipe-IT (404 du serveur web sur ${url}). ` +
      `Vérifiez trois choses : le sous-dossier d'installation s'il y en a un ` +
      `(https://serveur/snipeit et non https://serveur), l'absence de chemin ` +
      `d'interface dans l'adresse (pas /login ni /hardware), et le fait que ` +
      `${url.replace(/\/api\/v1.*$/, '')}/api/v1/hardware réponde bien du JSON dans un navigateur.`
    );
  }

  if (statut === 404) {
    return `Snipe-IT ne connaît pas cette route (404 sur ${url}). L'instance est-elle à jour ?`;
  }

  if (statut === 401 || statut === 403) {
    return (
      `Snipe-IT refuse le jeton (${statut}). Créez-en un nouveau dans votre profil → ` +
      `Manage API Keys, et vérifiez que le compte associé a le droit de consulter ` +
      `les actifs et les composants.`
    );
  }

  if (statut === 429) {
    return `Snipe-IT limite le débit (429). Réessayez dans quelques minutes.`;
  }

  if (statut >= 500) {
    return `Snipe-IT a rencontré une erreur interne (${statut}). Consultez ses journaux.`;
  }

  // Reste le cas où Snipe-IT répond du JSON d'erreur, qui est souvent parlant :
  // celui-là mérite d'être montré, contrairement à une page HTML.
  if (!html && corps) {
    return `Snipe-IT a répondu ${statut} : ${corps.slice(0, 200)}`;
  }

  return `Snipe-IT a répondu ${statut} sur ${url}.`;
}

/** Parcourt toutes les pages d'une collection Snipe-IT (`{ total, rows }`). */
async function toutesLesPages<T = any>(
  config: ConfigSnipeIt,
  chemin: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const lignes: T[] = [];

  for (let page = 0; page < PAGES_MAX; page += 1) {
    const reponse = await lire<{ total?: number; rows?: T[] }>(config, chemin, {
      ...params,
      limit: TAILLE_PAGE,
      offset: page * TAILLE_PAGE,
    });

    const lot = reponse.rows ?? [];
    lignes.push(...lot);

    if (lot.length < TAILLE_PAGE) break;
    if (typeof reponse.total === 'number' && lignes.length >= reponse.total) break;
  }

  return lignes;
}

/**
 * Adresses à essayer quand celle donnée ne répond pas.
 *
 * Trois erreurs de saisie couvrent presque tous les cas : oublier le
 * sous-dossier d'installation, coller l'adresse d'un écran plutôt que celle de
 * l'application, et pointer la racine du domaine quand le serveur web n'expose
 * pas le dossier `public/` de Laravel.
 */
function adressesCandidates(baseUrl: string): string[] {
  const base = racine({ baseUrl, token: '' });
  const candidates = [base];

  // Laravel sert son application depuis `public/` ; un hôte mal configuré
  // oblige à le nommer.
  candidates.push(`${base}/public`);

  // Un chemin d'interface collé depuis la barre d'adresse du navigateur.
  const CHEMINS_INTERFACE = [
    'login', 'dashboard', 'hardware', 'components', 'accessories',
    'consumables', 'licenses', 'users', 'settings', 'account', 'setup',
  ];

  try {
    const url = new URL(base);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0 && CHEMINS_INTERFACE.includes(segments[segments.length - 1].toLowerCase())) {
      segments.pop();
      candidates.push(`${url.origin}${segments.length ? `/${segments.join('/')}` : ''}`);
    }
  } catch {
    // Une adresse non analysable ne produit pas de candidat supplémentaire ;
    // la première tentative rendra un message clair.
  }

  return [...new Set(candidates)];
}

/**
 * Vérifie que l'adresse et le jeton mènent bien à une instance joignable.
 *
 * Sur `/hardware` plutôt que sur `/version` : cette dernière répond sur
 * certaines instances sans jeton valide, et confirmerait donc une
 * configuration qui échouera au premier import.
 *
 * Si l'adresse donnée échoue, quelques variantes sont essayées et la bonne est
 * **suggérée**, jamais substituée en douce : l'adresse est enregistrée et
 * réutilisée à chaque import, elle doit être celle que l'utilisateur a vue et
 * acceptée. Un test qui réussit sur une adresse différente de celle affichée
 * mentirait sur ce qui sera utilisé ensuite.
 */
export async function verifierConnexion(
  config: ConfigSnipeIt
): Promise<{
  ok: boolean;
  message: string;
  actifs?: number;
  composants?: number;
  urlSuggeree?: string;
}> {
  const candidates = adressesCandidates(config.baseUrl);
  let premiereErreur = '';

  for (const [index, baseUrl] of candidates.entries()) {
    try {
      const essai = { ...config, baseUrl };
      const [materiels, composants] = await Promise.all([
        lire<{ total?: number }>(essai, '/hardware', { limit: 1 }),
        lire<{ total?: number }>(essai, '/components', { limit: 1 }),
      ]);

      return {
        ok: true,
        message:
          index === 0
            ? 'Connexion établie'
            : `Connexion établie sur ${baseUrl}. Corrigez l'adresse ci-dessus, puis enregistrez.`,
        actifs: materiels.total ?? 0,
        composants: composants.total ?? 0,
        urlSuggeree: index === 0 ? undefined : baseUrl,
      };
    } catch (erreur: any) {
      if (index === 0) premiereErreur = erreur?.message ?? 'Connexion impossible';

      // Un jeton refusé est définitif : l'adresse est bonne, inutile d'en
      // essayer d'autres — et insister enverrait le jeton à des URL au hasard.
      if (erreur instanceof ErreurSnipeIt && (erreur.statut === 401 || erreur.statut === 403)) {
        return { ok: false, message: erreur.message };
      }
    }
  }

  return { ok: false, message: premiereErreur };
}

// ======================== ANALYSE ========================

const nombreOuNull = (valeur: unknown): number | null => {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  // Snipe-IT rend les montants tantôt en nombre, tantôt en chaîne formatée
  // (« 2,50 » ou « 2.50 ») selon la version et la locale de l'instance.
  const n = Number(String(valeur).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Un champ Snipe-IT qui est tantôt une chaîne, tantôt `{ date, formatted }`. */
const dateOuNull = (valeur: unknown): string | null => {
  if (!valeur) return null;
  if (typeof valeur === 'string') return valeur.slice(0, 10);
  const objet = valeur as { date?: string; datetime?: string };
  const brut = objet.datetime ?? objet.date;
  return brut ? String(brut).slice(0, 10) : null;
};

const texteOuNull = (valeur: unknown): string | null => {
  const t = String(valeur ?? '').trim();
  return t ? t : null;
};

/**
 * Construit le plan, sans rien écrire.
 *
 * Le lien composant → actif se lit composant par composant : Snipe-IT expose
 * `/components/{id}/assets` mais **pas** la route inverse sur un actif. Le
 * coût est d'un appel par clé, ce qui reste négligeable sur un parc de clés et
 * évite de reconstruire la composition à la main.
 */
export async function analyser(config: ConfigSnipeIt): Promise<PlanImport> {
  const avertissements: string[] = [];

  const [composantsBruts, actifsBruts] = await Promise.all([
    toutesLesPages<any>(config, '/components'),
    toutesLesPages<any>(config, '/hardware'),
  ]);

  const dejaImporte = await correspondances();

  // --- les clés
  const cles: PropositionCle[] = composantsBruts.map((c: any) => ({
    sourceId: Number(c.id),
    nom: String(c.name ?? '').trim(),
    modele: texteOuNull(c.model_number),
    serie: texteOuNull(c.serial),
    quantite: Math.max(0, Number(c.qty) || 0),
    prixUnitaire: nombreOuNull(c.purchase_cost),
    dateAchat: dateOuNull(c.purchase_date),
    categorieSnipe: texteOuNull(c.category?.name),
    lecture: lireLibelle(String(c.name ?? '')),
    objectIdExistant: dejaImporte.get(`component:${c.id}`) ?? null,
  }));

  // --- la composition, un appel par clé
  const composantsParActif = new Map<number, number[]>();
  for (const cle of cles) {
    try {
      const lignes = await toutesLesPages<any>(config, `/components/${cle.sourceId}/assets`);
      for (const ligne of lignes) {
        const actifId = Number(ligne.id ?? ligne.assigned_pivot_id);
        if (!Number.isFinite(actifId)) continue;
        const liste = composantsParActif.get(actifId);
        if (liste) liste.push(cle.sourceId);
        else composantsParActif.set(actifId, [cle.sourceId]);
      }
    } catch (erreur: any) {
      // Une clé dont la composition est illisible ne doit pas faire échouer
      // tout l'import : elle arrivera sans trousseau, et le message le dit.
      avertissements.push(
        `Composition indisponible pour « ${cle.nom} » : ${erreur?.message ?? 'erreur inconnue'}`
      );
    }
  }

  // --- les trousseaux
  const trousseaux: PropositionTrousseau[] = actifsBruts.map((a: any) => {
    const detenteur = a.assigned_to
      ? {
          type: String(a.assigned_to.type ?? 'user'),
          nom: String(a.assigned_to.name ?? '').trim(),
        }
      : null;

    return {
      sourceId: Number(a.id),
      inventaire: String(a.asset_tag ?? '').trim(),
      nom: String(a.name ?? '').trim() || String(a.asset_tag ?? '').trim(),
      serie: texteOuNull(a.serial),
      composants: composantsParActif.get(Number(a.id)) ?? [],
      detenteur,
      dateRemise: dateOuNull(a.last_checkout),
      objectIdExistant: dejaImporte.get(`asset:${a.id}`) ?? null,
    };
  });

  // --- les sites déduits
  const sitesParCle = new Map<string, string>();
  for (const cle of cles) {
    if (!cle.lecture.site) continue;
    const k = cleDeSite(cle.lecture.site);
    if (k && !sitesParCle.has(k)) sitesParCle.set(k, cle.lecture.site);
  }

  const sansInventaire = trousseaux.filter((t) => !t.inventaire).length;
  if (sansInventaire > 0) {
    avertissements.push(
      `${sansInventaire} actif(s) sans numéro d'inventaire : ils seront ignorés, ` +
        `un trousseau sans numéro ne peut pas être étiqueté.`
    );
  }

  const aVerifier = cles.filter((c) => c.lecture.confiance !== 'sure').length;
  if (aVerifier > 0) {
    avertissements.push(
      `${aVerifier} clé(s) dont le lieu n'a pas pu être déduit avec certitude de leur nom : ` +
        `à vérifier avant d'importer.`
    );
  }

  return { cles, trousseaux, sites: [...sitesParCle.values()], avertissements };
}

/** Ce qui a déjà été importé, par `type:id` distant. */
async function correspondances(): Promise<Map<string, number>> {
  const lignes = await db.query<{ source_type: string; source_id: number; object_id: number }>(
    'SELECT source_type, source_id, object_id FROM cle_import_snipeit WHERE object_id IS NOT NULL'
  );
  return new Map(lignes.map((l) => [`${l.source_type}:${l.source_id}`, l.object_id]));
}

// ======================== APPLICATION ========================

export interface ChoixImport {
  categoryId: number;
  subcategoryIdCles?: number | null;
  subcategoryIdTrousseaux?: number | null;
  /** Clés retenues, avec le rattachement éventuellement corrigé par l'écran. */
  cles: Array<{
    sourceId: number;
    site?: string | null;
    ouvrant?: string | null;
    estPasse?: boolean;
  }>;
  /** Identifiants Snipe-IT des trousseaux retenus. */
  trousseaux: number[];
  /** Reprendre le détenteur courant de Snipe-IT comme remise ouverte. */
  reprendreDetenteurs: boolean;
}

export interface ResultatImport {
  clesCreees: number;
  clesMisesAJour: number;
  trousseauxCrees: number;
  trousseauxMisAJour: number;
  sitesCrees: number;
  ouvrantsCrees: number;
  compositions: number;
  attributions: number;
  ignores: string[];
}

/**
 * Écrit le plan validé.
 *
 * N'écrit **que** ce que l'écran a montré : le plan reçu fait foi, rien n'est
 * relu depuis Snipe-IT ni redéduit d'un libellé. C'est ce qui rend l'aperçu
 * fiable — sans cela, une correction faite dans Snipe-IT entre l'analyse et la
 * validation entrerait en base sans que personne l'ait vue.
 */
export async function appliquer(
  plan: PlanImport,
  choix: ChoixImport,
  userId: number
): Promise<ResultatImport> {
  const resultat: ResultatImport = {
    clesCreees: 0,
    clesMisesAJour: 0,
    trousseauxCrees: 0,
    trousseauxMisAJour: 0,
    sitesCrees: 0,
    ouvrantsCrees: 0,
    compositions: 0,
    attributions: 0,
    ignores: [],
  };

  const parSourceId = new Map(plan.cles.map((c) => [c.sourceId, c]));
  const retenues = choix.cles.filter((c) => parSourceId.has(c.sourceId));

  // --- référentiel des lieux, avant les clés qui s'y rattachent
  const sitesParCle = new Map<string, number>();
  for (const ligne of await db.query<{ id: number; name: string }>('SELECT id, name FROM cle_sites')) {
    sitesParCle.set(cleDeSite(ligne.name), ligne.id);
  }

  const ouvrantsParCle = new Map<string, number>();
  for (const ligne of await db.query<{ id: number; site_id: number; name: string }>(
    'SELECT id, site_id, name FROM cle_ouvrants'
  )) {
    ouvrantsParCle.set(`${ligne.site_id}:${cleDeSite(ligne.name)}`, ligne.id);
  }

  async function siteDe(nom: string): Promise<number> {
    const k = cleDeSite(nom);
    const connu = sitesParCle.get(k);
    if (connu) return connu;

    const cree = await db.execute('INSERT INTO cle_sites (name) VALUES (?)', [nom]);
    const id = Number(cree.lastInsertRowid);
    sitesParCle.set(k, id);
    resultat.sitesCrees += 1;
    return id;
  }

  async function ouvrantDe(siteId: number, nom: string): Promise<number> {
    const k = `${siteId}:${cleDeSite(nom)}`;
    const connu = ouvrantsParCle.get(k);
    if (connu) return connu;

    const cree = await db.execute('INSERT INTO cle_ouvrants (site_id, name) VALUES (?, ?)', [
      siteId,
      nom,
    ]);
    const id = Number(cree.lastInsertRowid);
    ouvrantsParCle.set(k, id);
    resultat.ouvrantsCrees += 1;
    return id;
  }

  // --- les clés
  const objetParSource = new Map<number, number>();

  for (const choixCle of retenues) {
    const cle = parSourceId.get(choixCle.sourceId)!;
    if (!cle.nom) {
      resultat.ignores.push(`Composant ${cle.sourceId} sans nom`);
      continue;
    }

    let objectId = cle.objectIdExistant;

    if (objectId) {
      await db.execute('UPDATE objects SET name = ?, serial_number = ? WHERE id = ?', [
        cle.nom,
        cle.serie,
        objectId,
      ]);
      resultat.clesMisesAJour += 1;
    } else {
      // Le numéro de modèle va dans les champs personnalisés de la catégorie,
      // et non dans une colonne : c'est le mécanisme prévu par l'application,
      // et la migration 024 s'est interdit d'ajouter une colonne à `objects`.
      const champs = cle.modele ? JSON.stringify({ 'Numéro de modèle': cle.modele }) : null;

      const cree = await db.execute(
        `INSERT INTO objects
           (name, serial_number, category_id, subcategory_id, material_type, quantity_total,
            status, custom_fields, notes)
         VALUES (?, ?, ?, ?, 'lot', 0, 'active', ?, ?)`,
        [
          cle.nom,
          cle.serie,
          choix.categoryId,
          choix.subcategoryIdCles ?? null,
          champs,
          `Importé depuis Snipe-IT (composant ${cle.sourceId})`,
        ]
      );
      objectId = Number(cree.lastInsertRowid);
      resultat.clesCreees += 1;

      await db.execute(
        'INSERT INTO cle_import_snipeit (source_type, source_id, object_id) VALUES (?, ?, ?)',
        ['component', cle.sourceId, objectId]
      );

      // Le stock d'origine devient un premier lot, à son prix : c'est ce que
      // Snipe-IT sait dire, et le figer ici évite qu'une refabrication
      // ultérieure réévalue rétroactivement ce qui a déjà été payé.
      if (cle.quantite > 0) {
        await db.execute(
          `INSERT INTO cle_lots (object_id, quantity, unit_price, acquired_on, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            objectId,
            cle.quantite,
            cle.prixUnitaire,
            cle.dateAchat,
            'Stock repris de Snipe-IT',
            userId,
          ]
        );
        await recalculerDepuisLots(objectId);
      }
    }

    objetParSource.set(cle.sourceId, objectId);

    // --- ce que la clé ouvre, tel que validé dans l'écran
    const site = texteOuNull(choixCle.site);
    const ouvrant = texteOuNull(choixCle.ouvrant);

    if (site) {
      const siteId = await siteDe(site);
      await db.execute('DELETE FROM cle_ouvre WHERE object_id = ?', [objectId]);

      if (choixCle.estPasse || !ouvrant) {
        await db.execute('INSERT INTO cle_ouvre (object_id, site_id) VALUES (?, ?)', [
          objectId,
          siteId,
        ]);
      } else {
        const ouvrantId = await ouvrantDe(siteId, ouvrant);
        await db.execute('INSERT INTO cle_ouvre (object_id, ouvrant_id) VALUES (?, ?)', [
          objectId,
          ouvrantId,
        ]);
      }
    }
  }

  // --- les trousseaux
  const retenus = new Set(choix.trousseaux);

  for (const trousseau of plan.trousseaux) {
    if (!retenus.has(trousseau.sourceId)) continue;

    if (!trousseau.inventaire) {
      resultat.ignores.push(`Actif ${trousseau.sourceId} sans numéro d'inventaire`);
      continue;
    }

    let objectId = trousseau.objectIdExistant;

    if (objectId) {
      await db.execute('UPDATE objects SET name = ?, reference = ? WHERE id = ?', [
        trousseau.nom,
        trousseau.inventaire,
        objectId,
      ]);
      resultat.trousseauxMisAJour += 1;
    } else {
      // Le numéro d'inventaire est unique dans le parc : un `asset_tag` qui
      // existe déjà ici désigne autre chose, et l'écraser ferait disparaître
      // un matériel sans rapport.
      const occupe = await db.queryOne('SELECT id FROM objects WHERE reference = ?', [
        trousseau.inventaire,
      ]);
      if (occupe) {
        resultat.ignores.push(
          `Numéro d'inventaire ${trousseau.inventaire} déjà utilisé par un autre matériel`
        );
        continue;
      }

      const cree = await db.execute(
        `INSERT INTO objects
           (name, reference, serial_number, category_id, subcategory_id, material_type,
            quantity_total, status, notes)
         VALUES (?, ?, ?, ?, ?, 'unique', 1, 'active', ?)`,
        [
          trousseau.nom,
          trousseau.inventaire,
          trousseau.serie,
          choix.categoryId,
          choix.subcategoryIdTrousseaux ?? null,
          `Importé depuis Snipe-IT (actif ${trousseau.sourceId})`,
        ]
      );
      objectId = Number(cree.lastInsertRowid);
      resultat.trousseauxCrees += 1;

      await db.execute(
        'INSERT INTO cle_import_snipeit (source_type, source_id, object_id) VALUES (?, ?, ?)',
        ['asset', trousseau.sourceId, objectId]
      );
    }

    // --- composition
    await db.execute('DELETE FROM trousseau_composants WHERE trousseau_id = ?', [objectId]);
    for (const sourceComposant of trousseau.composants) {
      const cleId = objetParSource.get(sourceComposant);
      if (!cleId || cleId === objectId) continue;
      await db.execute(
        'INSERT INTO trousseau_composants (trousseau_id, object_id, quantity) VALUES (?, ?, 1)',
        [objectId, cleId]
      );
      resultat.compositions += 1;
    }

    // --- détenteur courant
    if (choix.reprendreDetenteurs && trousseau.detenteur?.nom) {
      const ouverte = await db.queryOne(
        'SELECT id FROM cle_attributions WHERE object_id = ? AND restitution_on IS NULL',
        [objectId]
      );

      if (!ouverte) {
        const rapproche = await rapprocherDetenteur(trousseau.detenteur);
        await db.execute(
          `INSERT INTO cle_attributions
             (object_id, quantity, holder_type, holder_user_id, holder_label, remise_on, remise_by, notes)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
          [
            objectId,
            rapproche.type,
            rapproche.userId,
            rapproche.label,
            trousseau.dateRemise ?? new Date().toISOString(),
            userId,
            rapproche.note,
          ]
        );
        resultat.attributions += 1;
      }
    }
  }

  return resultat;
}

/**
 * Rattache un détenteur Snipe-IT à un compte local, ou le garde en clair.
 *
 * Le rapprochement se fait sur le nom complet, faute de mieux : Snipe-IT rend
 * un libellé, pas une adresse électronique, sur `assigned_to` d'un actif. Un
 * agent qui n'a pas de compte ici — ou dont le nom s'écrit autrement — devient
 * un détenteur « externe » portant son nom, plutôt que d'être rattaché au
 * mauvais compte ou d'être perdu. Une clé attribuée à la mauvaise personne est
 * pire qu'une clé attribuée à un nom.
 *
 * Un actif sorti vers un **lieu** Snipe-IT tombe dans le même repli, et c'est
 * une perte de structure assumée : un lieu Snipe-IT est un bâtiment, donc un
 * `cle_sites` chez nous, alors qu'une attribution ne sait viser qu'un ouvrant —
 * une porte. Plutôt que de choisir arbitrairement une porte du bâtiment, on
 * garde le nom et la note dit d'où il vient, pour que « Mairie (externe) » ne
 * laisse personne perplexe devant sa fiche.
 */
async function rapprocherDetenteur(detenteur: {
  type: string;
  nom: string;
}): Promise<{ type: string; userId: number | null; label: string | null; note: string }> {
  if (detenteur.type === 'user') {
    const comptes = await db.query<{ id: number; first_name: string; last_name: string }>(
      'SELECT id, first_name, last_name FROM users WHERE is_active = 1'
    );

    const cherche = cleDeSite(detenteur.nom);
    for (const compte of comptes) {
      const complet = cleDeSite(`${compte.first_name ?? ''} ${compte.last_name ?? ''}`);
      const inverse = cleDeSite(`${compte.last_name ?? ''} ${compte.first_name ?? ''}`);
      if (cherche && (complet === cherche || inverse === cherche)) {
        return {
          type: 'user',
          userId: compte.id,
          label: null,
          note: 'Détention reprise de Snipe-IT',
        };
      }
    }
  }

  const origine =
    detenteur.type === 'location'
      ? 'un lieu Snipe-IT'
      : detenteur.type === 'asset'
        ? 'un autre actif Snipe-IT'
        : 'un compte Snipe-IT sans équivalent ici';

  return {
    type: 'externe',
    userId: null,
    label: detenteur.nom,
    note: `Détention reprise de Snipe-IT, où elle visait ${origine} (« ${detenteur.nom} »).`,
  };
}

// ======================== CONFIGURATION ========================

export async function configEnregistree(): Promise<(ConfigSnipeIt & { id: number }) | null> {
  const ligne = await db.queryOne<{ id: number; base_url: string; token: string }>(
    'SELECT id, base_url, token FROM snipeit_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
  );
  if (!ligne) return null;
  return { id: ligne.id, baseUrl: ligne.base_url, token: ligne.token };
}

export default { verifierConnexion, analyser, appliquer, configEnregistree };
