import {
  cadrageEnregistre,
  fond,
  lireCadrage,
  metresParPixel,
  transposer,
  transposerObjet,
  FONDS,
} from '../src/services/captureCarte.service';

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

describe('Recadrage : ce qui est posé suit le cadre', () => {
  /**
   * Le cœur du recadrage et du changement de fond.
   *
   * Les coordonnées du plan sont des pourcentages de l'image : elles ne veulent
   * rien dire hors du cadre qui les a vues naître. Remplacer l'image sans les
   * retraduire ne décale pas seulement des repères — cela change la surface des
   * zones, donc les quantités, donc les coûts, et **rien ne le signale**. Ces
   * tests sont là pour ça.
   */
  const cadre = { lat: 49.5721, lng: 0.9503, zoom: 18, largeur: 1200, hauteur: 800 };

  it('ne bouge rien quand le cadre ne change pas', () => {
    // Le cas du changement de fond : même vue, autre imagerie.
    for (const point of [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }, { x: 12.5, y: 87.25 }]) {
      const apres = transposer(point, cadre, cadre);
      expect(apres.x).toBeCloseTo(point.x, 9);
      expect(apres.y).toBeCloseTo(point.y, 9);
    }
  });

  it('le centre reste le centre quand on resserre autour du même point', () => {
    const serre = { ...cadre, largeur: 600, hauteur: 400 };
    const apres = transposer({ x: 50, y: 50 }, cadre, serre);
    expect(apres.x).toBeCloseTo(50, 9);
    expect(apres.y).toBeCloseTo(50, 9);
  });

  it('un demi-cadre agrandit les proportions du double', () => {
    // Moitié moins large sur le même centre : le quart et les trois quarts
    // deviennent les deux bords, et le bord d'avant sort du cadre.
    const serre = { ...cadre, largeur: 600, hauteur: 400 };
    expect(transposer({ x: 25, y: 50 }, cadre, serre).x).toBeCloseTo(0, 9);
    expect(transposer({ x: 75, y: 50 }, cadre, serre).x).toBeCloseTo(100, 9);
    expect(transposer({ x: 0, y: 50 }, cadre, serre).x).toBeCloseTo(-50, 9);
    expect(transposer({ x: 100, y: 50 }, cadre, serre).x).toBeCloseTo(150, 9);
  });

  it('un zoom plus profond ne déplace pas le terrain visé', () => {
    // Doubler le zoom en doublant les dimensions couvre exactement le même
    // terrain : c'est ce que fait la capture pour gagner en finesse.
    const fin = { ...cadre, zoom: 19, largeur: 2400, hauteur: 1600 };
    for (const point of [{ x: 10, y: 20 }, { x: 50, y: 50 }, { x: 90, y: 80 }]) {
      const apres = transposer(point, cadre, fin);
      expect(apres.x).toBeCloseTo(point.x, 6);
      expect(apres.y).toBeCloseTo(point.y, 6);
    }
  });

  it('revient au point de départ après un aller-retour', () => {
    const autre = { lat: 49.5735, lng: 0.9488, zoom: 19, largeur: 900, hauteur: 700 };
    const depart = { x: 37.4, y: 62.8 };
    const retour = transposer(transposer(depart, cadre, autre), autre, cadre);
    expect(retour.x).toBeCloseTo(depart.x, 6);
    expect(retour.y).toBeCloseTo(depart.y, 6);
  });

  it('signale un contour que le nouveau cadre couperait', () => {
    const serre = { ...cadre, largeur: 600, hauteur: 400 };
    const zone = JSON.stringify([{ x: 10, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }]);

    const coupe = transposerObjet({ zone_points: zone }, cadre, serre);
    expect(coupe.sort).toBe(true);

    // Le même contour, entièrement dans la moitié centrale : rien n'est coupé.
    const dedans = JSON.stringify([{ x: 40, y: 48 }, { x: 60, y: 48 }, { x: 60, y: 52 }]);
    expect(transposerObjet({ zone_points: dedans }, cadre, serre).sort).toBe(false);
  });

  it('signale un repère que le nouveau cadre laisserait dehors', () => {
    const serre = { ...cadre, largeur: 600, hauteur: 400 };
    expect(transposerObjet({ pos_x: 10, pos_y: 50 }, cadre, serre).sort).toBe(true);
    expect(transposerObjet({ pos_x: 50, pos_y: 50 }, cadre, serre).sort).toBe(false);
  });

  it('ne voit rien à déplacer sur un objet qui n’est pas sur le plan', () => {
    const resultat = transposerObjet({ pos_x: null, pos_y: null, zone_points: null }, cadre, cadre);
    expect(resultat.pos).toBeNull();
    expect(resultat.zone).toBeNull();
    expect(resultat.sort).toBe(false);
  });

  /**
   * La surface réelle ne doit pas changer : le contour couvre le même terrain.
   * Si elle changeait, toutes les quantités et tous les coûts dériveraient à
   * chaque recadrage — l'erreur la plus coûteuse que puisse faire ce code.
   */
  it('conserve la surface réelle du contour à travers un recadrage', () => {
    const serre = { lat: 49.5721, lng: 0.9503, zoom: 19, largeur: 800, hauteur: 600 };
    const zone = [{ x: 45, y: 45 }, { x: 55, y: 45 }, { x: 55, y: 55 }, { x: 45, y: 55 }];

    const surface = (points: { x: number; y: number }[], c: typeof cadre) => {
      const mParPourcent = (metresParPixel(c.lat, c.zoom) * c.largeur) / 100;
      let somme = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        somme += a.x * b.y - b.x * a.y;
      }
      return (Math.abs(somme) / 2) * mParPourcent ** 2 * (c.hauteur / c.largeur);
    };

    const avant = surface(zone, cadre);
    const apres = surface(zone.map((p) => transposer(p, cadre, serre)), serre);
    expect(apres).toBeCloseTo(avant, 6);

    /*
      Et le chiffre lui-même est juste. Le contrôle passe par un autre chemin
      que la formule testée : le rectangle mesure 10 % de la largeur du cadre
      sur 10 % de sa hauteur, et le cadre mesure `largeur × mètres par pixel`
      sur `hauteur × mètres par pixel`. Une erreur de ratio dans la formule du
      lacet — l'oubli classique, celui qui double ou divise par deux toutes les
      surfaces — ne survivrait pas à cette comparaison.
    */
    const mpp = metresParPixel(cadre.lat, cadre.zoom);
    const attendu = 0.1 * cadre.largeur * mpp * (0.1 * cadre.hauteur * mpp);
    expect(avant).toBeCloseTo(attendu, 6);
  });

  it('relit un cadrage enregistré, et rejette ce qui n’en est pas un', () => {
    const enregistre = cadrageEnregistre(JSON.stringify({ ...cadre, fond: 'photo' }));
    expect(enregistre).toMatchObject({ ...cadre, fond: 'photo' });

    // Un fond disparu retombe sur le premier proposé plutôt que de bloquer.
    expect(cadrageEnregistre(JSON.stringify({ ...cadre, fond: 'bing' }))?.fond).toBe(FONDS[0].cle);

    expect(cadrageEnregistre(null)).toBeNull();
    expect(cadrageEnregistre('pas du json')).toBeNull();
    expect(cadrageEnregistre(JSON.stringify({ lat: 200, lng: 0, zoom: 18, largeur: 800, hauteur: 600 }))).toBeNull();
  });
})
