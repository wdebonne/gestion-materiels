import { fond, lireCadrage, metresParPixel, FONDS } from '../src/services/captureCarte.service';

/**
 * Le plan fabriqué depuis la carte.
 *
 * Tout l'intérêt de cet écran tient dans une promesse : le plan sort **calibré**,
 * et plus personne n'a à mesurer quoi que ce soit. Si l'échelle calculée est
 * fausse, rien ne le signale — les surfaces s'affichent avec la même assurance
 * qu'avant, les coûts en découlent, et l'erreur ne se découvre qu'au moment de
 * commander l'enrobé. C'est exactement le défaut que la fonctionnalité était
 * censée supprimer.
 *
 * Ces tests tiennent donc la formule de Web Mercator sur des valeurs
 * indépendamment vérifiables, et le garde-fou qui empêche de demander au
 * serveur d'aspirer un département entier de tuiles.
 *
 * Rien ici ne touche au réseau : l'assemblage lui-même dépend de services
 * publics extérieurs, qu'un test ne doit ni marteler ni attendre.
 */

describe('Échelle déduite de la carte', () => {
  /**
   * La valeur de référence de Web Mercator : au zoom 0, à l'équateur, une tuile
   * de 256 pixels couvre la circonférence de la Terre.
   */
  it('donne 156 543 m par pixel au zoom 0 à l’équateur', () => {
    expect(metresParPixel(0, 0)).toBeCloseTo(156543.034, 2);
  });

  it('divise la taille du pixel par deux à chaque niveau de zoom', () => {
    for (let zoom = 0; zoom < 20; zoom++) {
      expect(metresParPixel(45, zoom + 1)).toBeCloseTo(metresParPixel(45, zoom) / 2, 9);
    }
  });

  /**
   * La latitude n'est pas un détail : Mercator étire les distances vers les
   * pôles. L'oublier donnerait, en Normandie, des surfaces surestimées de plus
   * de moitié — 1 / cos(49,5°) ≈ 1,54.
   */
  it('resserre le pixel à mesure qu’on monte vers le nord', () => {
    const equateur = metresParPixel(0, 18);
    expect(metresParPixel(49.5, 18)).toBeCloseTo(equateur * Math.cos((49.5 * Math.PI) / 180), 9);
    expect(metresParPixel(49.5, 18)).toBeLessThan(equateur);
  });

  /** Un repère concret : au zoom 18 sous nos latitudes, le pixel vaut ~39 cm. */
  it('donne environ 39 cm par pixel au zoom 18 en Normandie', () => {
    expect(metresParPixel(49.5721, 18)).toBeCloseTo(0.3873, 3);
  });

  /**
   * `metresParPourcent` est ce qui part en base. Il vaut la largeur réelle
   * divisée par cent — et non la taille d'un pixel, confusion qui donnerait des
   * surfaces fausses d'un facteur égal à la largeur de l'image.
   */
  it('fait correspondre un pourcent de largeur à un centième du terrain cadré', () => {
    const largeur = 1200;
    const metresParPourcent = (metresParPixel(49.5721, 18) * largeur) / 100;
    expect(metresParPourcent * 100).toBeCloseTo(464.7, 1);
  });
});

describe('Relecture du cadrage demandé', () => {
  const valide = { lat: 49.5721, lng: 0.9503, zoom: 18, largeur: 1200, hauteur: 800 };

  it('accepte un cadrage de parc ordinaire', () => {
    expect(lireCadrage(valide)).toEqual(valide);
  });

  it('arrondit les dimensions et le zoom, qui indexent des tuiles entières', () => {
    const lu = lireCadrage({ ...valide, zoom: 18.4, largeur: 1200.7, hauteur: 800.2 });
    expect(lu).toEqual({ ...valide, largeur: 1201 });
  });

  it('refuse des coordonnées qui ne désignent aucun endroit', () => {
    expect(lireCadrage({ ...valide, lat: 'ici' })).toBeNull();
    expect(lireCadrage({ ...valide, lat: 91 })).toBeNull();
    expect(lireCadrage({ ...valide, lng: 200 })).toBeNull();
    expect(lireCadrage(undefined)).toBeNull();
  });

  it('refuse un zoom où le parc ne serait qu’une tache', () => {
    expect(lireCadrage({ ...valide, zoom: 3 })).toBeNull();
  });

  /**
   * Le vrai garde-fou : sans lui, une demande de 2400 × 2400 au zoom 19 ferait
   * tomber une centaine de requêtes sur un service public gratuit, ce que la
   * politique d'usage d'OpenStreetMap interdit explicitement.
   */
  it('refuse un cadrage qui demanderait trop de tuiles d’un coup', () => {
    expect(lireCadrage({ ...valide, largeur: 2400, hauteur: 2400 })).toBeNull();
    expect(lireCadrage({ ...valide, largeur: 1600, hauteur: 1200 })).not.toBeNull();
  });

  it('refuse une image trop petite pour qu’on y pose quoi que ce soit', () => {
    expect(lireCadrage({ ...valide, largeur: 100 })).toBeNull();
  });
});

describe('Fonds de carte', () => {
  it('reconnaît les fonds proposés et rejette les autres', () => {
    expect(fond('photo')?.libelle).toBe('Photo aérienne');
    expect(fond('osm')).not.toBeNull();
    expect(fond('google-satellite')).toBeNull();
    expect(fond('')).toBeNull();
  });

  /**
   * Citer la source est une obligation de licence, pour l'IGN comme pour
   * OpenStreetMap, et le plan produit circule ensuite en PDF et en pièce jointe
   * sans l'écran qui l'affichait.
   */
  it('porte une attribution et un plafond de zoom sur chaque fond', () => {
    expect(FONDS.length).toBeGreaterThan(0);
    for (const f of FONDS) {
      expect(f.attribution.trim().length).toBeGreaterThan(0);
      expect(f.zoomMax).toBeGreaterThanOrEqual(18);
      expect(f.modele).toContain('{z}');
      expect(f.modele).toContain('{x}');
      expect(f.modele).toContain('{y}');
    }
  });
});
