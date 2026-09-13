/**
 * Planches d'étiquettes Avery.
 *
 * L'impression d'étiquettes existait déjà, mais sur une grille figée de deux
 * colonnes sur 52 mm qui ne correspondait à aucune planche du commerce : les
 * étiquettes tombaient à cheval sur les découpes. Chaque référence Avery a ses
 * cotes, ses marges et ses écarts, et c'est à elles que la grille doit se caler.
 *
 * Les cotes sont en millimètres, unité dans laquelle Avery publie ses planches
 * et que CSS accepte telle quelle à l'impression. Rien n'est converti en pixels :
 * une conversion dépendrait du DPI et ferait dériver l'alignement d'un
 * millimètre par ligne, ce qui suffit à décaler la dernière rangée.
 *
 * Le `profil` n'est pas une préférence esthétique, c'est une contrainte de
 * place. Une L6008 fait dix millimètres de haut : il n'y tient qu'un QR minuscule
 * et un numéro. Y mettre le même contenu qu'une L7165, treize fois plus grande,
 * produirait une bouillie illisible. Le composant d'impression choisit donc quoi
 * afficher d'après ce profil, et non d'après la référence.
 *
 * Les cotes des planches « ultra-résistantes » comme la L6008 varient d'un
 * revendeur à l'autre — on trouve 25,4 et 26,4 mm pour la même référence. D'où
 * la planche de calibrage : on imprime les contours à vide, on compare à la
 * planche réelle, et on ajuste au besoin dans les réglages.
 */

export type ProfilEtiquette = 'complet' | 'compact' | 'minuscule';

export interface FormatAvery {
  /** Référence commerciale, telle qu'imprimée sur la boîte. */
  ref: string;
  libelle: string;
  /** Cotes d'une étiquette, en millimètres. */
  largeur: number;
  hauteur: number;
  colonnes: number;
  lignes: number;
  /** Marges de la planche A4, en millimètres. */
  margeHaut: number;
  margeGauche: number;
  /** Espacement entre étiquettes, en millimètres. */
  ecartH: number;
  ecartV: number;
  profil: ProfilEtiquette;
  /** Ce à quoi la planche sert le mieux, pour guider le choix. */
  usage: string;
}

export const FORMATS_AVERY: readonly FormatAvery[] = [
  {
    ref: 'L7160',
    libelle: '63,5 × 38,1 mm — 21 par planche',
    largeur: 63.5,
    hauteur: 38.1,
    colonnes: 3,
    lignes: 7,
    margeHaut: 15.1,
    margeGauche: 7.2,
    ecartH: 2.5,
    ecartV: 0,
    profil: 'complet',
    usage: 'Polyvalent. Le bon choix par défaut pour un trousseau.',
  },
  {
    ref: 'L7163',
    libelle: '99,1 × 38,1 mm — 14 par planche',
    largeur: 99.1,
    hauteur: 38.1,
    colonnes: 2,
    lignes: 7,
    margeHaut: 15.1,
    margeGauche: 5.5,
    ecartH: 2.5,
    ecartV: 0,
    profil: 'complet',
    usage: 'Allongé : laisse la place de lister ce que le trousseau ouvre.',
  },
  {
    ref: 'L7165',
    libelle: '99,1 × 67,7 mm — 8 par planche',
    largeur: 99.1,
    hauteur: 67.7,
    colonnes: 2,
    lignes: 4,
    margeHaut: 13.1,
    margeGauche: 5.5,
    ecartH: 2.5,
    ecartV: 0,
    profil: 'complet',
    usage: 'Grand format, pour un tableau de clés mural ou une boîte à clés.',
  },
  {
    ref: 'L7651',
    libelle: '38,1 × 21,2 mm — 65 par planche',
    largeur: 38.1,
    hauteur: 21.2,
    colonnes: 5,
    lignes: 13,
    margeHaut: 10.7,
    margeGauche: 4.7,
    ecartH: 2.5,
    ecartV: 0,
    profil: 'compact',
    usage: 'Petit : pour étiqueter les clés et les badges eux-mêmes.',
  },
  {
    ref: 'L6008',
    libelle: '25,4 × 10 mm — 189 par planche (ultra-résistant)',
    largeur: 25.4,
    hauteur: 10,
    colonnes: 7,
    lignes: 27,
    margeHaut: 8.5,
    margeGauche: 7.75,
    ecartH: 2.5,
    ecartV: 0,
    profil: 'minuscule',
    usage: 'Polyester résistant, pour marquer une clé à vie. Numéro seul ou QR minuscule.',
  },
];

export const FORMAT_PAR_DEFAUT = 'L7160';

export function formatParRef(ref: string): FormatAvery {
  return FORMATS_AVERY.find((f) => f.ref === ref) ?? FORMATS_AVERY[0];
}

/** Nombre d'étiquettes par planche. */
export function parPlanche(format: FormatAvery): number {
  return format.colonnes * format.lignes;
}

/**
 * Côté du QR code, en millimètres, pour une étiquette donnée.
 *
 * Le QR occupe la hauteur disponible moins une marge, et ne dépasse jamais le
 * tiers de la largeur sur les grands formats — au-delà il écrase le numéro
 * d'inventaire, qui est ce qu'on lit à l'œil nu dans 99 % des cas.
 */
export function tailleQr(format: FormatAvery): number {
  const disponible = format.hauteur - (format.profil === 'minuscule' ? 1.5 : 4);
  const plafond = format.largeur * (format.profil === 'complet' ? 0.32 : 0.45);
  return Math.max(0, Math.min(disponible, plafond));
}

/**
 * Un QR de ce côté, portant cette adresse, est-il raisonnablement scannable ?
 *
 * Repère empirique : il faut environ 0,4 mm par module pour qu'un téléphone
 * lise une impression laser. Le nombre de modules dépend de la longueur des
 * données — une URL courte tient en version 2 (25 modules), une longue passe en
 * version 4 ou plus. En dessous du seuil, l'écran retire le QR et ne laisse que
 * le numéro : une étiquette lisible sans QR vaut mieux qu'un QR que personne ne
 * peut scanner.
 */
export function qrLisible(cote: number, longueurUrl: number): boolean {
  const modules = longueurUrl <= 25 ? 25 : longueurUrl <= 47 ? 29 : longueurUrl <= 77 ? 33 : 41;
  return cote / modules >= 0.4;
}
