/**
 * Correspondance entre les colonnes d'un fichier et les champs d'un matériel.
 *
 * L'import était **positionnel strict** sur onze colonnes : le fichier devait
 * suivre le modèle au caractère près. Conséquence la plus visible, l'export de
 * l'application ne pouvait pas être réimporté — il commence par une colonne
 * `ID` que le modèle n'a pas, ce qui décale tout d'un cran et fait échouer
 * chaque ligne sur « Catégorie introuvable ».
 *
 * Or exporter, corriger dans un tableur, réimporter est le geste naturel pour
 * un inventaire annuel.
 *
 * Les colonnes sont désormais reconnues par leur intitulé, quel que soit leur
 * ordre, et une colonne inconnue — `ID` en particulier — est simplement ignorée.
 */

export type ChampImport =
  | 'name'
  | 'category'
  | 'subcategory'
  | 'reference'
  | 'serialNumber'
  | 'status'
  | 'location'
  | 'purchaseDate'
  | 'purchasePrice'
  | 'description'
  | 'notes';

export interface DefinitionChamp {
  champ: ChampImport;
  libelle: string;
  obligatoire: boolean;
  /** Intitulés acceptés, déjà normalisés. */
  alias: string[];
}

/**
 * Ordre de référence, utilisé par le modèle téléchargeable et comme repli
 * positionnel pour un fichier sans en-tête reconnaissable.
 */
export const CHAMPS_IMPORT: DefinitionChamp[] = [
  {
    champ: 'name',
    libelle: 'Nom',
    obligatoire: true,
    alias: ['nom', 'name', 'libelle', 'designation', 'materiel', 'equipement', 'intitule'],
  },
  {
    champ: 'category',
    libelle: 'Catégorie',
    obligatoire: true,
    alias: ['categorie', 'category', 'famille'],
  },
  {
    champ: 'subcategory',
    libelle: 'Sous-catégorie',
    obligatoire: false,
    alias: ['sous categorie', 'souscategorie', 'subcategory', 'sous famille'],
  },
  {
    champ: 'reference',
    libelle: 'Référence',
    obligatoire: false,
    alias: ['reference', 'ref', 'code'],
  },
  {
    champ: 'serialNumber',
    libelle: 'N° de série',
    obligatoire: false,
    alias: ['n serie', 'no serie', 'numero de serie', 'numero serie', 'serial number', 'serial', 'serie'],
  },
  {
    champ: 'status',
    libelle: 'Statut',
    obligatoire: false,
    alias: ['statut', 'status', 'etat'],
  },
  {
    champ: 'location',
    libelle: 'Localisation',
    obligatoire: false,
    alias: ['localisation', 'location', 'lieu', 'emplacement', 'site'],
  },
  {
    champ: 'purchaseDate',
    libelle: "Date d'achat",
    obligatoire: false,
    alias: ['date d achat', 'date achat', 'date d acquisition', 'purchase date', 'date'],
  },
  {
    champ: 'purchasePrice',
    libelle: "Prix d'achat",
    obligatoire: false,
    alias: ['prix d achat', 'prix achat', 'prix', 'purchase price', 'montant', 'cout'],
  },
  {
    champ: 'description',
    libelle: 'Description',
    obligatoire: false,
    alias: ['description', 'descriptif'],
  },
  {
    champ: 'notes',
    libelle: 'Notes',
    obligatoire: false,
    alias: ['notes', 'note', 'commentaire', 'commentaires', 'remarque', 'remarques', 'observations'],
  },
];

/** Correspondance champ → index de colonne (base 1, comme ExcelJS). */
export type Correspondance = Partial<Record<ChampImport, number>>;

/**
 * Ramène un intitulé à une forme comparable : sans accent, sans ponctuation,
 * sans astérisque d'obligation, sans parenthèses explicatives.
 *
 * « Date d'achat (AAAA-MM-JJ) » et « date achat » doivent se rejoindre.
 */
export function normaliserEntete(brut: unknown): string {
  return String(brut ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Reconnaît les colonnes d'après leur intitulé.
 *
 * Une colonne inconnue est ignorée : c'est ce qui permet de réimporter un
 * export, dont la première colonne `ID` ne correspond à aucun champ. Le premier
 * intitulé qui correspond gagne, pour qu'un fichier comportant deux colonnes
 * proches n'écrase pas la bonne.
 */
export function detecterColonnes(entetes: unknown[]): Correspondance {
  const correspondance: Correspondance = {};

  entetes.forEach((entete, position) => {
    const normalise = normaliserEntete(entete);
    if (!normalise) return;

    const definition = CHAMPS_IMPORT.find((d) => d.alias.includes(normalise));
    if (definition && correspondance[definition.champ] === undefined) {
      // ExcelJS numérote les colonnes à partir de 1.
      correspondance[definition.champ] = position + 1;
    }
  });

  return correspondance;
}

/**
 * Repli positionnel, dans l'ordre du modèle téléchargeable.
 *
 * Utilisé quand aucun intitulé n'est reconnu : un fichier sans ligne d'en-tête
 * reste importable, exactement comme avant.
 */
export function correspondancePositionnelle(): Correspondance {
  const correspondance: Correspondance = {};
  CHAMPS_IMPORT.forEach((d, i) => {
    correspondance[d.champ] = i + 1;
  });
  return correspondance;
}

/** Champs obligatoires qu'aucune colonne ne renseigne. */
export function champsObligatoiresManquants(correspondance: Correspondance): DefinitionChamp[] {
  return CHAMPS_IMPORT.filter((d) => d.obligatoire && correspondance[d.champ] === undefined);
}

/**
 * Correspondance à appliquer : celle imposée par l'utilisateur, sinon celle
 * déduite des intitulés, sinon le repli positionnel.
 */
export function resoudreCorrespondance(
  entetes: unknown[],
  imposee?: Correspondance | null
): { correspondance: Correspondance; origine: 'imposee' | 'entetes' | 'positionnelle' } {
  if (imposee && Object.keys(imposee).length > 0) {
    return { correspondance: imposee, origine: 'imposee' };
  }

  const detectee = detecterColonnes(entetes);
  if (Object.keys(detectee).length > 0) {
    return { correspondance: detectee, origine: 'entetes' };
  }

  return { correspondance: correspondancePositionnelle(), origine: 'positionnelle' };
}

/** Valeur d'un champ dans une ligne, `null` si la colonne est absente ou vide. */
export function valeurDe(
  ligne: any[],
  correspondance: Correspondance,
  champ: ChampImport
): string | null {
  const index = correspondance[champ];
  if (index === undefined) return null;

  const brut = ligne[index];
  if (brut === undefined || brut === null) return null;

  // ExcelJS rend parfois un objet pour les formules, les liens et les dates.
  const texte = typeof brut === 'object'
    ? String(brut.text ?? brut.result ?? brut.hyperlink ?? brut)
    : String(brut);

  const nettoye = texte.trim();
  return nettoye === '' ? null : nettoye;
}
