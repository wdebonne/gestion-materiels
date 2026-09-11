import {
  aireEnM2,
  aireShoelace,
  borner,
  centroide,
  deplacerZone,
  echelleDepuisCalibrage,
  formaterSurface,
  insererSommet,
  longueurEnM,
  parseZonePoints,
  pointDansPolygone,
  retirerSommet,
} from '../client/src/components/plan/geometrie';

/**
 * La géométrie du plan annoté.
 *
 * Une surface de massif finit dans un budget : si le calcul est faux, personne
 * ne s'en aperçoit avant de commander l'enrobé. Ces tests tiennent les deux
 * pièges du plan.
 *
 * **Le plan n'est pas carré.** Les coordonnées sont des pourcentages de largeur
 * *et* de hauteur, et l'overlay SVG étire l'image
 * (`preserveAspectRatio="none"`). Un pourcent vertical ne mesure donc pas comme
 * un pourcent horizontal, et l'oublier fausse toute surface d'un facteur égal au
 * rapport de l'image — un plan deux fois plus large que haut donnerait le double.
 *
 * **Un clic doit rester sur le plan.** Les coordonnées viennent d'une souris et
 * repartent en base : une valeur hors bornes y reste, et le repère devient
 * invisible sans qu'on puisse le rattraper.
 */

/** Un plan deux fois plus large que haut, calibré à 2 m le pourcent de largeur. */
const ECHELLE = { metresParPourcent: 2, ratio: 0.5 };

describe('Bornage des coordonnées', () => {
  it('laisse passer ce qui est sur le plan', () => {
    expect(borner(0)).toBe(0);
    expect(borner(42.7)).toBe(42.7);
    expect(borner(100)).toBe(100);
  });

  it('ramène sur le plan ce qui déborde', () => {
    expect(borner(-3)).toBe(0);
    expect(borner(140)).toBe(100);
  });

  it("rend zéro plutôt que NaN quand le calcul n'a pas abouti", () => {
    // Une division par une largeur nulle arrive quand l'image n'est pas encore
    // chargée : mieux vaut le coin haut-gauche qu'un repère introuvable. Une
    // coordonnée infinie ne veut rien dire non plus, et retombe au même endroit.
    expect(borner(NaN)).toBe(0);
    expect(borner(Infinity)).toBe(0);
    expect(borner(-Infinity)).toBe(0);
  });
});

describe('Lecture des zones enregistrées', () => {
  it('lit une zone écrite en JSON', () => {
    expect(parseZonePoints('[{"x":1,"y":2},{"x":3,"y":4}]')).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('accepte un tableau déjà lu', () => {
    expect(parseZonePoints([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
  });

  it('rend une zone vide plutôt que de faire échouer le plan', () => {
    // La colonne a été remplie sans validation pendant des mois : un plan qui
    // refuse de s'afficher est pire qu'une zone manquante.
    expect(parseZonePoints(null)).toEqual([]);
    expect(parseZonePoints('')).toEqual([]);
    expect(parseZonePoints('pas du json')).toEqual([]);
    expect(parseZonePoints('{"x":1}')).toEqual([]);
  });

  it('écarte les points illisibles sans jeter les autres', () => {
    expect(parseZonePoints('[{"x":1,"y":2},{"x":"nord"},null,{"x":"3","y":"4"}]')).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});

describe('Aire du polygone', () => {
  const carre = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('mesure un carré', () => {
    expect(aireShoelace(carre)).toBe(100);
  });

  it('ignore le sens de parcours', () => {
    // L'ordre des clics dépend de la personne : une surface négative ne veut
    // rien dire pour un massif.
    expect(aireShoelace([...carre].reverse())).toBe(100);
  });

  it('mesure un polygone concave', () => {
    // Un L de 10×10 amputé d'un carré de 5×5.
    const forme = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(aireShoelace(forme)).toBe(75);
  });

  it('rend zéro tant que la zone n’est pas fermée', () => {
    expect(aireShoelace([])).toBe(0);
    expect(aireShoelace([{ x: 0, y: 0 }])).toBe(0);
    expect(aireShoelace([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(0);
  });

  it('rend zéro pour des points alignés', () => {
    expect(
      aireShoelace([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ])
    ).toBe(0);
  });
});

describe('Conversion en mètres', () => {
  const carre = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("tient compte du rapport de l'image", () => {
    // 10 % de largeur = 20 m ; 10 % de hauteur = 20 × 0,5 = 10 m. Donc 200 m².
    // Sans le ratio, on annoncerait 400 m² : le double, sur un budget d'enrobé.
    expect(aireEnM2(carre, ECHELLE)).toBeCloseTo(200, 6);
  });

  it('rend null tant que le plan n’est pas calibré', () => {
    // Un nombre inventé se lirait comme une mesure.
    expect(aireEnM2(carre, null)).toBeNull();
    expect(aireEnM2(carre, { metresParPourcent: 0, ratio: 1 })).toBeNull();
  });

  it('mesure une longueur horizontale et une verticale différemment', () => {
    const a = { x: 0, y: 0 };
    expect(longueurEnM(a, { x: 10, y: 0 }, ECHELLE)).toBeCloseTo(20, 6);
    expect(longueurEnM(a, { x: 0, y: 10 }, ECHELLE)).toBeCloseTo(10, 6);
  });
});

describe('Calibrage', () => {
  it('déduit l’échelle du segment tracé', () => {
    // 25 % de largeur déclarés à 50 m : le pourcent vaut 2 m.
    const echelle = echelleDepuisCalibrage(
      { a: { x: 10, y: 0 }, b: { x: 35, y: 0 }, metres: 50 },
      0.5
    );
    expect(echelle!.metresParPourcent).toBeCloseTo(2, 6);
    expect(echelle!.ratio).toBe(0.5);
  });

  it('refuse un segment trop court', () => {
    // Deux clics au même endroit donneraient une échelle infinie, et toutes les
    // surfaces avec.
    expect(
      echelleDepuisCalibrage({ a: { x: 10, y: 10 }, b: { x: 10.1, y: 10 }, metres: 50 }, 1)
    ).toBeNull();
  });

  it('refuse une longueur nulle ou négative', () => {
    expect(
      echelleDepuisCalibrage({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, metres: 0 }, 1)
    ).toBeNull();
    expect(
      echelleDepuisCalibrage({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, metres: -5 }, 1)
    ).toBeNull();
  });
});

describe('Retouche des sommets', () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  it('insère un sommet au milieu du segment suivant', () => {
    expect(insererSommet(triangle, 0)[1]).toEqual({ x: 5, y: 0 });
  });

  it('referme la boucle sur le dernier segment', () => {
    // Le segment qui suit le dernier sommet est celui qui revient au premier.
    expect(insererSommet(triangle, 2)[3]).toEqual({ x: 0, y: 5 });
  });

  it('retire un sommet', () => {
    const carre = [...triangle, { x: 10, y: 10 }];
    expect(retirerSommet(carre, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ]);
  });

  it('refuse de descendre sous trois sommets', () => {
    // En dessous, il n'y a plus de zone — seulement un trait qu'on ne saurait
    // ni afficher ni mesurer.
    expect(retirerSommet(triangle, 0)).toEqual(triangle);
  });
});

describe('Déplacement d’une zone', () => {
  const carre = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
  ];

  it('déplace tous les sommets ensemble', () => {
    expect(deplacerZone(carre, 5, -5)).toEqual([
      { x: 15, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 15 },
      { x: 15, y: 15 },
    ]);
  });

  it('arrête la zone au bord sans la déformer', () => {
    // Borner chaque point séparément écraserait le carré contre le bord ; c'est
    // le décalage qui est rogné, pas la forme.
    const arrete = deplacerZone(carre, 200, 0);
    expect(arrete).toEqual([
      { x: 90, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 20 },
      { x: 90, y: 20 },
    ]);
  });
});

describe('Centre et appartenance', () => {
  const carre = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('place l’étiquette au centre de gravité', () => {
    const centre = centroide(carre)!;
    expect(centre.x).toBeCloseTo(5, 6);
    expect(centre.y).toBeCloseTo(5, 6);
  });

  it('retombe sur la moyenne pour un polygone plat', () => {
    const centre = centroide([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ])!;
    expect(centre.x).toBeCloseTo(5, 6);
    expect(centre.y).toBeCloseTo(5, 6);
  });

  it('sait ce qui est dedans et ce qui est dehors', () => {
    expect(pointDansPolygone({ x: 5, y: 5 }, carre)).toBe(true);
    expect(pointDansPolygone({ x: 15, y: 5 }, carre)).toBe(false);
  });
});

describe('Affichage d’une surface', () => {
  // `toLocaleString('fr-FR')` sépare les milliers par une espace fine
  // insécable (U+202F), invisible à l'œil et différente d'une espace ordinaire :
  // comparer les deux littéralement ferait échouer un test sur une apparence
  // pourtant correcte.
  const sansEspacesFines = (texte: string) => texte.replace(/[  ]/g, ' ');

  it('garde une décimale sous cent mètres carrés', () => {
    expect(formaterSurface(12.44)).toBe('12,4 m²');
  });

  it('arrondit au-delà : le dixième de mètre carré ne veut plus rien dire', () => {
    expect(sansEspacesFines(formaterSurface(1240.4))).toBe('1 240 m²');
  });

  it('n’écrit rien plutôt qu’un zéro qui se lirait comme une mesure', () => {
    expect(formaterSurface(null)).toBe('');
    expect(formaterSurface(undefined)).toBe('');
    expect(formaterSurface(NaN)).toBe('');
  });
});
