import {
  normaliserEntete,
  detecterColonnes,
  correspondancePositionnelle,
  champsObligatoiresManquants,
  resoudreCorrespondance,
  valeurDe,
  CHAMPS_IMPORT,
} from '../src/services/importMapping.service';

/**
 * Correspondance des colonnes à l'import.
 *
 * L'import était **positionnel strict** sur onze colonnes : le fichier devait
 * suivre le modèle au caractère près. Conséquence la plus visible, l'export de
 * l'application ne pouvait pas être réimporté — il commence par une colonne
 * `ID` que le modèle n'a pas, ce qui décalait tout d'un cran et faisait échouer
 * chaque ligne sur « Catégorie introuvable ».
 *
 * Or exporter, corriger dans un tableur, réimporter est le geste naturel d'un
 * inventaire annuel.
 */

/** En-têtes réellement produits par `GET /import-export/export`. */
const ENTETES_EXPORT = [
  'ID', 'Nom', 'Catégorie', 'Sous-catégorie', 'Référence', 'N° Série',
  'Statut', 'Localisation', "Date d'achat", "Prix d'achat", 'Description', 'Notes',
];

/** En-têtes du modèle téléchargeable, avec leurs astérisques et parenthèses. */
const ENTETES_MODELE = [
  'Nom *', 'Catégorie *', 'Sous-catégorie', 'Référence', 'N° Série', 'Statut',
  'Localisation', "Date d'achat (AAAA-MM-JJ)", "Prix d'achat", 'Description', 'Notes',
];

describe('Normalisation des intitulés', () => {
  it('ignore accents, ponctuation, astérisques et parenthèses', () => {
    expect(normaliserEntete('Nom *')).toBe('nom');
    expect(normaliserEntete('Catégorie *')).toBe('categorie');
    expect(normaliserEntete("Date d'achat (AAAA-MM-JJ)")).toBe('date d achat');
    expect(normaliserEntete('N° Série')).toBe('n serie');
    expect(normaliserEntete('  SOUS-CATÉGORIE  ')).toBe('sous categorie');
  });

  it('supporte une case vide', () => {
    expect(normaliserEntete(null)).toBe('');
    expect(normaliserEntete(undefined)).toBe('');
    expect(normaliserEntete('   ')).toBe('');
  });
});

describe('Reconnaissance des colonnes', () => {
  it('reconnaît le modèle téléchargeable', () => {
    const c = detecterColonnes(ENTETES_MODELE);
    expect(c.name).toBe(1);
    expect(c.category).toBe(2);
    expect(c.notes).toBe(11);
    expect(champsObligatoiresManquants(c)).toEqual([]);
  });

  it('reconnaît l’export de l’application, colonne `ID` comprise', () => {
    // C'est le cas qui échouait : `ID` décalait tout d'un cran.
    const c = detecterColonnes(ENTETES_EXPORT);
    expect(c.name).toBe(2);
    expect(c.category).toBe(3);
    expect(c.notes).toBe(12);
    expect(champsObligatoiresManquants(c)).toEqual([]);
  });

  it('ignore une colonne inconnue au lieu de tout décaler', () => {
    const c = detecterColonnes(['Identifiant interne', 'Nom', 'Famille']);
    expect(c.name).toBe(2);
    expect(c.category).toBe(3);
  });

  it('accepte un ordre quelconque et des intitulés courants', () => {
    const c = detecterColonnes(['Localisation', 'Désignation', 'Famille', 'Ref']);
    expect(c.location).toBe(1);
    expect(c.name).toBe(2);
    expect(c.category).toBe(3);
    expect(c.reference).toBe(4);
  });

  it('retient la première colonne correspondante', () => {
    // Deux colonnes proches ne doivent pas se remplacer l'une l'autre.
    const c = detecterColonnes(['Nom', 'Libellé']);
    expect(c.name).toBe(1);
  });

  it('ne reconnaît rien dans un fichier sans intitulés', () => {
    expect(detecterColonnes(['Tondeuse', 'Espaces verts', 'REF-1'])).toEqual({});
  });
});

describe('Champs obligatoires', () => {
  it('signale une colonne obligatoire absente', () => {
    const manquants = champsObligatoiresManquants(detecterColonnes(['Nom', 'Référence']));
    expect(manquants.map((d) => d.champ)).toEqual(['category']);
  });

  it('n’exige que le nom et la catégorie', () => {
    const obligatoires = CHAMPS_IMPORT.filter((d) => d.obligatoire).map((d) => d.champ);
    expect(obligatoires).toEqual(['name', 'category']);
  });
});

describe('Choix de la correspondance', () => {
  it('privilégie celle imposée par l’utilisateur', () => {
    // C'est ce qui rend une reconnaissance ratée corrigeable à l'écran.
    const { correspondance, origine } = resoudreCorrespondance(ENTETES_EXPORT, { name: 5, category: 6 });
    expect(origine).toBe('imposee');
    expect(correspondance).toEqual({ name: 5, category: 6 });
  });

  it('déduit des intitulés à défaut', () => {
    const { origine } = resoudreCorrespondance(ENTETES_EXPORT);
    expect(origine).toBe('entetes');
  });

  it('retombe sur l’ordre du modèle quand rien n’est reconnu', () => {
    // Un fichier sans ligne d'en-tête reste importable, comme avant.
    const { correspondance, origine } = resoudreCorrespondance(['Tondeuse', 'Espaces verts']);
    expect(origine).toBe('positionnelle');
    expect(correspondance).toEqual(correspondancePositionnelle());
  });

  it('ignore une correspondance imposée vide', () => {
    expect(resoudreCorrespondance(ENTETES_EXPORT, {}).origine).toBe('entetes');
    expect(resoudreCorrespondance(ENTETES_EXPORT, null).origine).toBe('entetes');
  });
});

describe('Lecture d’une valeur', () => {
  // ExcelJS numérote les colonnes à partir de 1 et laisse la case 0 vide.
  const ligne = [undefined, '70', 'Tondeuse', '  Espaces verts  ', '', null];
  const correspondance = { name: 2, category: 3, reference: 4, notes: 5 };

  it('lit la colonne désignée et enlève les espaces', () => {
    expect(valeurDe(ligne, correspondance, 'name')).toBe('Tondeuse');
    expect(valeurDe(ligne, correspondance, 'category')).toBe('Espaces verts');
  });

  it('rend null pour une case vide ou une colonne absente', () => {
    expect(valeurDe(ligne, correspondance, 'reference')).toBeNull();
    expect(valeurDe(ligne, correspondance, 'notes')).toBeNull();
    expect(valeurDe(ligne, correspondance, 'location')).toBeNull();
  });

  it('extrait le texte d’une cellule enrichie', () => {
    // ExcelJS rend un objet pour un lien, une formule ou du texte enrichi.
    const enrichie = [undefined, { text: 'Tondeuse', hyperlink: 'http://x' }, { result: 42 }];
    expect(valeurDe(enrichie, { name: 1, purchasePrice: 2 }, 'name')).toBe('Tondeuse');
    expect(valeurDe(enrichie, { name: 1, purchasePrice: 2 }, 'purchasePrice')).toBe('42');
  });
});
