import crypto from 'crypto';
import { db } from '../database';
import { normaliserLibelle } from '../utils/normaliserLibelle';
import { expressionDisponibilite, jointuresDisponibilite } from './materielPretable.service';
import { expressionPrestation } from './prestationParc.service';

/**
 * Réception d'une demande de manifestation envoyée par une application tierce.
 *
 * Les demandes arrivaient par un formulaire externe et étaient ressaisies à la
 * main. Le contrat d'entrée n'est pas figé : chaque formulaire nomme ses champs
 * à sa façon, et il changera sans prévenir. La correspondance entre le JSON reçu
 * et les champs d'une manifestation est donc une **donnée**, configurable par un
 * administrateur, et non du code — exactement le choix déjà fait pour les
 * colonnes d'un tableur dans `importMapping.service.ts`, dont ce module reprend
 * la forme et la règle de normalisation.
 */

export type ChampIntake =
  | 'title'
  | 'date_start'
  | 'date_end'
  | 'start_time'
  | 'end_time'
  | 'delivery_date'
  | 'recovery_date'
  | 'delivery_address'
  | 'contact_name'
  | 'contact_phone'
  | 'contact_email'
  | 'expected_people'
  | 'notes_interior'
  | 'notes_exterior'
  | 'external_id';

export type TypeChamp = 'texte' | 'date' | 'heure' | 'entier';

export interface DefinitionChampIntake {
  champ: ChampIntake;
  libelle: string;
  obligatoire: boolean;
  type: TypeChamp;
  /** Noms de clés acceptés, déjà normalisés. */
  alias: string[];
}

/**
 * Champs qu'une demande peut renseigner.
 *
 * Seuls le titre et la date de début sont obligatoires : ce sont les deux que la
 * table `manifestations` exige. Tout le reste peut manquer et être complété à la
 * main — une demande incomplète vaut mieux qu'une demande perdue.
 */
export const CHAMPS_INTAKE: DefinitionChampIntake[] = [
  {
    champ: 'title',
    libelle: 'Nom de la manifestation',
    obligatoire: true,
    type: 'texte',
    alias: [
      'titre', 'title', 'nom', 'name', 'nom de la manifestation', 'manifestation',
      'evenement', 'event', 'intitule', 'objet',
    ],
  },
  {
    champ: 'date_start',
    libelle: 'Date de la manifestation',
    obligatoire: true,
    type: 'date',
    alias: [
      'date de debut', 'date debut', 'date start', 'start date', 'date',
      'date de la manifestation', 'date manifestation', 'date de l evenement',
    ],
  },
  {
    champ: 'date_end',
    libelle: 'Date de fin',
    obligatoire: false,
    type: 'date',
    alias: ['date de fin', 'date fin', 'end date', 'date end'],
  },
  {
    champ: 'start_time',
    libelle: 'Heure de début',
    obligatoire: false,
    type: 'heure',
    alias: ['heure de debut', 'heure debut', 'start time', 'debut'],
  },
  {
    champ: 'end_time',
    libelle: 'Heure de fin',
    obligatoire: false,
    type: 'heure',
    alias: ['heure de fin', 'heure fin', 'end time', 'fin'],
  },
  {
    champ: 'delivery_date',
    libelle: 'Date de livraison',
    obligatoire: false,
    type: 'date',
    alias: ['date de livraison', 'date livraison', 'delivery date', 'livraison'],
  },
  {
    champ: 'recovery_date',
    libelle: 'Date de récupération',
    obligatoire: false,
    type: 'date',
    alias: [
      'date de recuperation', 'date recuperation', 'recovery date', 'recuperation',
      'date de reprise', 'date reprise', 'date de retour', 'retour',
    ],
  },
  {
    champ: 'delivery_address',
    libelle: 'Lieu de livraison',
    obligatoire: false,
    type: 'texte',
    alias: [
      'lieu de livraison', 'adresse de livraison', 'adresse livraison', 'lieu',
      'adresse', 'delivery address', 'location', 'emplacement', 'site',
    ],
  },
  {
    champ: 'contact_name',
    libelle: 'Contact',
    obligatoire: false,
    type: 'texte',
    alias: [
      'contact', 'nom du contact', 'contact name', 'demandeur', 'nom du demandeur',
      'responsable', 'organisateur', 'contact de livraison',
    ],
  },
  {
    champ: 'contact_phone',
    libelle: 'Téléphone du contact',
    obligatoire: false,
    type: 'texte',
    alias: [
      'telephone', 'tel', 'phone', 'contact phone', 'telephone du contact',
      'portable', 'mobile', 'numero de telephone',
    ],
  },
  {
    champ: 'contact_email',
    libelle: 'Courriel du contact',
    obligatoire: false,
    type: 'texte',
    alias: ['email', 'e mail', 'mail', 'courriel', 'contact email', 'adresse email'],
  },
  {
    champ: 'expected_people',
    libelle: 'Personnes attendues',
    obligatoire: false,
    type: 'entier',
    alias: [
      'personnes attendues', 'nombre de personnes', 'nb personnes', 'effectif',
      'participants', 'expected people', 'public attendu',
    ],
  },
  {
    champ: 'notes_interior',
    libelle: 'Notes',
    obligatoire: false,
    type: 'texte',
    alias: ['notes', 'note', 'commentaire', 'commentaires', 'remarques', 'precisions', 'message'],
  },
  {
    champ: 'notes_exterior',
    libelle: 'Notes extérieures',
    obligatoire: false,
    type: 'texte',
    alias: ['notes exterieures', 'note exterieure', 'observations'],
  },
  {
    champ: 'external_id',
    libelle: "Identifiant d'origine",
    obligatoire: false,
    type: 'texte',
    alias: [
      'id', 'identifiant', 'reference', 'ref', 'external id', 'form id',
      'submission id', 'numero de demande', 'numero',
    ],
  },
];

/** Correspondance champ → chemin pointé dans la charge utile reçue. */
export type CorrespondanceIntake = Partial<Record<ChampIntake, string>>;

/**
 * Comment lire les lignes de matériel dans la charge utile.
 *
 * `liste` : `chemin` désigne un tableau, chaque entrée portant un libellé et une
 * quantité. `objet` : `chemin` désigne un objet dont les clés sont les libellés
 * et les valeurs les quantités. Les deux formes se rencontrent selon que le
 * formulaire pose une question répétable ou une case par article.
 */
export interface CorrespondanceMateriel {
  mode?: 'liste' | 'objet';
  chemin?: string;
  champ_libelle?: string;
  champ_quantite?: string;
}

// ======================== LECTURE DE LA CHARGE UTILE ========================

/**
 * Valeur à un chemin pointé, `undefined` si le chemin ne mène nulle part.
 *
 * Les index de tableau s'écrivent comme des segments : `reponses.0.valeur`.
 */
export function valeurAuChemin(source: unknown, chemin: string): unknown {
  if (!chemin) return undefined;

  let courant: any = source;
  for (const segment of chemin.split('.')) {
    if (courant === null || courant === undefined) return undefined;
    courant = courant[segment];
  }
  return courant;
}

const PROFONDEUR_MAX = 6;

/**
 * Tous les chemins menant à une valeur simple.
 *
 * Sert à peupler l'écran de correspondance avec les chemins réellement présents
 * dans la dernière demande reçue, plutôt que de laisser l'administrateur les
 * deviner. La profondeur est bornée : une charge utile cyclique ou absurdement
 * imbriquée ne doit pas faire tourner le serveur en rond.
 */
export function cheminsDe(source: unknown, prefixe = '', profondeur = 0): string[] {
  if (profondeur >= PROFONDEUR_MAX || source === null || source === undefined) return [];

  if (Array.isArray(source)) {
    return source.flatMap((valeur, i) =>
      cheminsDe(valeur, prefixe ? `${prefixe}.${i}` : String(i), profondeur + 1)
    );
  }

  if (typeof source === 'object') {
    return Object.entries(source as Record<string, unknown>).flatMap(([cle, valeur]) =>
      cheminsDe(valeur, prefixe ? `${prefixe}.${cle}` : cle, profondeur + 1)
    );
  }

  return prefixe ? [prefixe] : [];
}

/**
 * Reconnaît les champs d'après le nom de la dernière clé du chemin.
 *
 * Le chemin complet importe peu : `data.reponses.contact_email` et
 * `contact_email` désignent la même chose. Le premier chemin qui correspond
 * gagne, pour qu'une charge utile comportant deux clés proches n'écrase pas la
 * bonne.
 */
export function detecterChamps(payload: unknown): CorrespondanceIntake {
  const correspondance: CorrespondanceIntake = {};

  for (const chemin of cheminsDe(payload)) {
    const derniereCle = chemin.split('.').pop() ?? '';
    const normalise = normaliserLibelle(derniereCle);
    if (!normalise) continue;

    const definition = CHAMPS_INTAKE.find((d) => d.alias.includes(normalise));
    if (definition && correspondance[definition.champ] === undefined) {
      correspondance[definition.champ] = chemin;
    }
  }

  return correspondance;
}

/**
 * Correspondance à appliquer : celle configurée sur la source, sinon celle
 * déduite des noms de clés.
 */
export function resoudreCorrespondance(
  payload: unknown,
  imposee?: CorrespondanceIntake | null
): { correspondance: CorrespondanceIntake; origine: 'imposee' | 'detectee' } {
  if (imposee && Object.keys(imposee).length > 0) {
    return { correspondance: imposee, origine: 'imposee' };
  }
  return { correspondance: detecterChamps(payload), origine: 'detectee' };
}

// ======================== CONVERSION DES VALEURS ========================

/**
 * Date ramenée au format `AAAA-MM-JJ`.
 *
 * Les formulaires rendent aussi bien `14/07/2026` que `2026-07-14T09:00:00Z`.
 * Une date non reconnue est rendue `null` plutôt que devinée : une manifestation
 * placée au mauvais jour bloquerait le mauvais matériel.
 */
export function normaliserDate(brut: unknown): string | null {
  if (brut === null || brut === undefined) return null;

  const texte = String(brut).trim();
  if (!texte) return null;

  const iso = texte.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const francais = texte.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (francais) {
    const jour = francais[1].padStart(2, '0');
    const mois = francais[2].padStart(2, '0');
    return `${francais[3]}-${mois}-${jour}`;
  }

  return null;
}

/** Heure ramenée à `HH:MM`, `null` si elle n'est pas reconnue. */
export function normaliserHeure(brut: unknown): string | null {
  if (brut === null || brut === undefined) return null;

  const trouve = String(brut).trim().match(/(\d{1,2})[h:](\d{2})?/i);
  if (!trouve) return null;

  const heures = trouve[1].padStart(2, '0');
  return `${heures}:${trouve[2] ?? '00'}`;
}

/** Entier, `null` si la valeur n'en contient pas. */
export function normaliserEntier(brut: unknown): number | null {
  if (brut === null || brut === undefined) return null;

  const trouve = String(brut).replace(/\s/g, '').match(/-?\d+/);
  if (!trouve) return null;

  const valeur = Number.parseInt(trouve[0], 10);
  return Number.isNaN(valeur) ? null : valeur;
}

function convertir(valeur: unknown, type: TypeChamp): string | number | null {
  switch (type) {
    case 'date':
      return normaliserDate(valeur);
    case 'heure':
      return normaliserHeure(valeur);
    case 'entier':
      return normaliserEntier(valeur);
    default: {
      if (valeur === null || valeur === undefined) return null;
      const texte = typeof valeur === 'object' ? JSON.stringify(valeur) : String(valeur);
      const nettoye = texte.trim();
      return nettoye === '' ? null : nettoye;
    }
  }
}

export interface ManifestationRecue {
  champs: Partial<Record<ChampIntake, string | number>>;
  /** Champs obligatoires qu'aucun chemin ne renseigne. */
  manquants: DefinitionChampIntake[];
}

/** Applique la correspondance à une charge utile et convertit chaque valeur. */
export function extraireManifestation(
  payload: unknown,
  correspondance: CorrespondanceIntake
): ManifestationRecue {
  const champs: Partial<Record<ChampIntake, string | number>> = {};

  for (const definition of CHAMPS_INTAKE) {
    const chemin = correspondance[definition.champ];
    if (!chemin) continue;

    const valeur = convertir(valeurAuChemin(payload, chemin), definition.type);
    if (valeur !== null) champs[definition.champ] = valeur;
  }

  const manquants = CHAMPS_INTAKE.filter(
    (d) => d.obligatoire && champs[d.champ] === undefined
  );

  return { champs, manquants };
}

// ======================== MATÉRIEL DEMANDÉ ========================

export interface LigneMaterielRecue {
  libelle: string;
  quantite: number;
}

/** Chemins où chercher le matériel quand la source n'en désigne aucun. */
const CHEMINS_MATERIEL_PROBABLES = [
  'materiels', 'materiel', 'materials', 'items', 'articles',
  'data.materiels', 'data.materiel', 'data.materials', 'data.items',
];

/**
 * Lignes de matériel demandées.
 *
 * Un libellé nu sans quantité vaut 1 : un formulaire à cases à cocher ne dit pas
 * « 1 sono », il dit « sono ». Une entrée textuelle « 10 tables » est découpée,
 * parce que c'est ainsi qu'un agent la saisit dans un champ libre.
 */
export function extraireMateriels(
  payload: unknown,
  correspondance?: CorrespondanceMateriel | null
): LigneMaterielRecue[] {
  const chemins = correspondance?.chemin
    ? [correspondance.chemin]
    : CHEMINS_MATERIEL_PROBABLES;

  for (const chemin of chemins) {
    const source = valeurAuChemin(payload, chemin);
    if (source === undefined || source === null) continue;

    const lignes = lireLignes(source, correspondance);
    if (lignes.length > 0) return lignes;
  }

  return [];
}

function lireLignes(
  source: unknown,
  correspondance?: CorrespondanceMateriel | null
): LigneMaterielRecue[] {
  if (Array.isArray(source)) {
    return source.map((entree) => lireEntree(entree, correspondance)).filter(estUtile);
  }

  if (typeof source === 'object' && source !== null) {
    // Forme « objet » : une clé par article, la valeur porte la quantité.
    return Object.entries(source as Record<string, unknown>)
      .map(([libelle, quantite]) => ({
        libelle: String(libelle).trim(),
        quantite: normaliserEntier(quantite) ?? (quantite ? 1 : 0),
      }))
      .filter(estUtile);
  }

  if (typeof source === 'string') {
    return source
      .split(/[\n;,]+/)
      .map((morceau) => decouperLibelle(morceau))
      .filter(estUtile);
  }

  return [];
}

function lireEntree(
  entree: unknown,
  correspondance?: CorrespondanceMateriel | null
): LigneMaterielRecue {
  if (typeof entree === 'string') return decouperLibelle(entree);

  if (typeof entree === 'object' && entree !== null) {
    const objet = entree as Record<string, unknown>;

    const cleLibelle = correspondance?.champ_libelle ?? trouverCle(objet, ALIAS_LIBELLE);
    const cleQuantite = correspondance?.champ_quantite ?? trouverCle(objet, ALIAS_QUANTITE);

    const libelle = cleLibelle ? String(objet[cleLibelle] ?? '').trim() : '';
    const quantite = cleQuantite ? normaliserEntier(objet[cleQuantite]) : null;

    return { libelle, quantite: quantite ?? 1 };
  }

  return { libelle: '', quantite: 0 };
}

const ALIAS_LIBELLE = ['libelle', 'nom', 'name', 'materiel', 'article', 'designation', 'label', 'intitule'];
const ALIAS_QUANTITE = ['quantite', 'quantity', 'qte', 'qty', 'nombre', 'nb'];

function trouverCle(objet: Record<string, unknown>, alias: string[]): string | undefined {
  return Object.keys(objet).find((cle) => alias.includes(normaliserLibelle(cle)));
}

/** « 10 tables » → 10 × « tables ». Sans nombre en tête, la quantité vaut 1. */
function decouperLibelle(brut: string): LigneMaterielRecue {
  const texte = brut.trim();
  if (!texte) return { libelle: '', quantite: 0 };

  const avecNombre = texte.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
  if (avecNombre) {
    return { libelle: avecNombre[2].trim(), quantite: Number.parseInt(avecNombre[1], 10) };
  }

  return { libelle: texte, quantite: 1 };
}

const estUtile = (ligne: LigneMaterielRecue): boolean =>
  ligne.libelle.length > 0 && ligne.quantite > 0;

/** Un libellé reçu, rapproché de ce qu'il désigne — et de la table qui le porte. */
export interface ArticleApparie {
  source: 'stock' | 'parc';
  id: number;
  name: string;
  unit: string;
  is_prestation: boolean;
}

/**
 * Rapproche un libellé reçu d'un article proposable.
 *
 * D'abord le stock des manifestations : sur le nom normalisé, puis sur les alias
 * enregistrés — « tables » doit trouver « Table 180 cm » sans qu'on rebaptise le
 * stock. Puis le parc prêtable, où vivent les exemplaires, les lots et les
 * prestations déclarées par branche. Le catalogue propose les deux sources ; ne
 * relire que la première laissait « Raccordement électrique » en ligne à
 * rattacher, alors qu'il figurait au formulaire que la collectivité a publié.
 *
 * Le parc n'est consulté que sur ce qu'il accepte de prêter et ce qui est actif :
 * la réception ne doit pas engager un matériel que le catalogue n'aurait jamais
 * proposé.
 *
 * Aucune correspondance approximative : mieux vaut laisser une ligne à rattacher
 * à la main que de réserver le mauvais matériel.
 */
export async function apparierMateriel(libelle: string): Promise<ArticleApparie | null> {
  const recherche = normaliserLibelle(libelle);
  if (!recherche) return null;

  const duStock = (article: any): ArticleApparie => ({
    source: 'stock',
    id: Number(article.id),
    name: String(article.name ?? ''),
    unit: String(article.unit ?? ''),
    is_prestation: Boolean(article.is_prestation),
  });

  const articles = await db.query('SELECT id, name, unit, is_prestation FROM manifestation_stock');
  const parNom = articles.find((a: any) => normaliserLibelle(a.name) === recherche);
  if (parNom) return duStock(parNom);

  const alias = await db.query('SELECT stock_id, alias FROM manifestation_stock_aliases');
  const correspondant = alias.find((a: any) => normaliserLibelle(a.alias) === recherche);
  if (correspondant) {
    const article = articles.find((a: any) => a.id === correspondant.stock_id);
    if (article) return duStock(article);
  }

  const objets = await db.query(
    `SELECT o.id, o.name, ${expressionPrestation()} as is_prestation
     FROM objects o
     ${jointuresDisponibilite()}
     WHERE ${expressionDisponibilite()} = 1 AND o.status = 'active'`
  );
  const objet = objets.find((o: any) => normaliserLibelle(o.name) === recherche);
  if (!objet) return null;

  return {
    source: 'parc',
    id: Number(objet.id),
    name: String(objet.name ?? ''),
    unit: '',
    is_prestation: Boolean(Number(objet.is_prestation)),
  };
}

// ======================== SIGNATURE ========================

/**
 * Vérifie la signature HMAC d'une charge utile reçue.
 *
 * Même convention que l'émission (`webhook.service.ts`) : `sha256=<hexa>` sur les
 * octets exacts du corps. La comparaison passe par `timingSafeEqual` — comparer
 * deux chaînes avec `===` laisse fuir, par le temps de réponse, le nombre de
 * caractères devinés.
 */
export function signatureValide(
  corpsBrut: Buffer | string | undefined,
  entete: string | undefined,
  secret: string
): boolean {
  if (!corpsBrut || !entete || !secret) return false;

  const attendue = crypto.createHmac('sha256', secret).update(corpsBrut).digest('hex');
  const recue = entete.startsWith('sha256=') ? entete.slice('sha256='.length) : entete;

  const a = Buffer.from(attendue, 'utf8');
  const b = Buffer.from(recue, 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/** Secret d'une source, assez long pour ne pas se deviner. */
export function genererSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}
