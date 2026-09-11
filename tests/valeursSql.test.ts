import { dateOuNull, fusionner, nombreFusionne, nombreOuNull } from '../src/utils/valeursSql';
import { parametresMySQL } from '../src/database';

/**
 * Ce qu'un formulaire vide envoie à la base.
 *
 * Toute cette famille de pannes ne se voit que sur MySQL, et jamais en
 * développement : SQLite est typé dynamiquement et range sans un mot une chaîne
 * vide dans une colonne `DATE`, là où MySQL en mode strict refuse et fait
 * retomber la route sur son `catch` — « Erreur serveur », 500, sans rien dire
 * de plus. C'est exactement ce qui empêchait d'enregistrer un entretien dont le
 * « prochain entretien » et le coût n'étaient pas renseignés.
 *
 * Deux causes distinctes, deux corrections, et ces tests les tiennent :
 * le champ laissé vide (`''`) et le champ que le client n'envoie pas
 * (`undefined`).
 */

describe('valeurs destinées à une colonne date ou numérique', () => {
  it('traduit en NULL ce qui n’a pas été saisi', () => {
    for (const vide of ['', '   ', null, undefined]) {
      expect(dateOuNull(vide)).toBeNull();
      expect(nombreOuNull(vide)).toBeNull();
    }
  });

  it('laisse passer une date telle qu’elle a été saisie', () => {
    // Pas de reformatage : corriger un format ici masquerait une saisie fausse
    // au lieu de la signaler.
    expect(dateOuNull('2026-09-02')).toBe('2026-09-02');
    expect(dateOuNull('2026-09-02T10:00:00Z')).toBe('2026-09-02T10:00:00Z');
  });

  it('rend un nombre, quelle que soit la forme reçue', () => {
    // Un champ de formulaire envoie du texte, même quand il est de type nombre.
    expect(nombreOuNull('124523')).toBe(124523);
    expect(nombreOuNull('89.90')).toBe(89.9);
    expect(nombreOuNull(0)).toBe(0);
  });

  it('préfère NULL à NaN pour une saisie incompréhensible', () => {
    // `NULL` dit « non renseigné » ; `NaN` dirait « saisi, et illisible » — et
    // serait refusé par la colonne de toute façon.
    expect(nombreOuNull('abc')).toBeNull();
  });
});

describe('paramètres envoyés à MySQL', () => {
  it('traduit `undefined` en NULL', () => {
    // mysql2 refuse de lier `undefined` : « Bind parameters must not contain
    // undefined ». Une colonne absente du formulaire suffisait donc à rendre
    // toute une écriture impossible, sur MySQL et sur MySQL seulement.
    expect(parametresMySQL([undefined, null, 1])).toEqual([null, null, 1]);
  });

  it('laisse la chaîne vide intacte', () => {
    // Pour une colonne texte, la chaîne vide est une valeur légitime : la
    // convertir changerait le sens de ce qui est enregistré. C'est aux routes
    // de la traduire pour les colonnes date et numériques.
    expect(parametresMySQL([''])).toEqual(['']);
  });

  it('convertit une date ISO avec fuseau en date MySQL', () => {
    expect(parametresMySQL(['2026-08-30T17:47:37.028Z'])).toEqual(['2026-08-30 17:47:37']);
  });

  it('ne touche pas à ce qui n’est pas une date à fuseau explicite', () => {
    // Sans fuseau, l'instant est ambigu : le convertir le décalerait du fuseau
    // du serveur.
    expect(parametresMySQL(['2026-08-30T17:47:37'])).toEqual(['2026-08-30T17:47:37']);
    expect(parametresMySQL(['2026-08-30'])).toEqual(['2026-08-30']);
    expect(parametresMySQL([42, true, 'Vidange'])).toEqual([42, true, 'Vidange']);
  });
});

/**
 * Ce qu'une modification partielle doit laisser tranquille.
 *
 * Une distinction que le code avait perdue : ne **pas parler** d'un champ
 * (`undefined`) n'est pas demander à l'**effacer** (`null`). Les deux
 * arrivaient au même `null`, et le prix se payait ailleurs, en silence — faire
 * glisser un massif sur le plan envoie `{pos_x, pos_y}` et rien d'autre, et sa
 * surface partait avec ; corriger l'adresse d'un espace vert décalibrait son
 * plan, et toutes les surfaces cessaient de se calculer.
 *
 * Rien ne le signalait : un chiffre juste devenait un vide, et on ne s'en
 * apercevait qu'en rouvrant la fiche des semaines plus tard.
 */
describe('modification partielle d’une colonne numérique', () => {
  it('garde la valeur existante quand le champ n’est pas mentionné', () => {
    expect(nombreFusionne(undefined, 1000)).toBe(1000);
    expect(nombreFusionne(undefined, null)).toBeNull();
    expect(nombreFusionne(undefined, 0)).toBe(0);
  });

  it('efface quand on le demande explicitement', () => {
    // Ce que fait « Retirer du plan » : `pos_x: null`.
    expect(nombreFusionne(null, 42)).toBeNull();
    expect(nombreFusionne('', 42)).toBeNull();
  });

  it('écrit la nouvelle valeur quand il y en a une', () => {
    expect(nombreFusionne(7, 42)).toBe(7);
    expect(nombreFusionne('7.5', 42)).toBe(7.5);
    // Zéro est une valeur et non une absence : une surface doit pouvoir être
    // corrigée vers zéro.
    expect(nombreFusionne(0, 42)).toBe(0);
  });

  /** La régression exacte, telle qu'elle se produisait sur le plan annoté. */
  it('ne touche pas à la surface quand on ne déplace qu’un repère', () => {
    const recu: Record<string, unknown> = { pos_x: 50, pos_y: 50 };
    const existant = { pos_x: 30, area_m2: 1000, latitude: 49.5721 };

    expect(nombreFusionne(recu.pos_x, existant.pos_x)).toBe(50);
    expect(nombreFusionne(recu.area_m2, existant.area_m2)).toBe(1000);
    expect(nombreFusionne(recu.latitude, existant.latitude)).toBe(49.5721);
  });

  /**
   * L'appariement piégé, gardé comme preuve. `fusionner` et `nombreOuNull` sont
   * justes chacun de son côté ; c'est leur composition qui détruit la
   * distinction, la seconde rendant `null` là où la première attend `undefined`
   * pour ne rien faire.
   */
  it('montre pourquoi fusionner(nombreOuNull(x)) ne pouvait pas marcher', () => {
    expect(fusionner(nombreOuNull(undefined), 1000)).toBeNull();
    expect(nombreFusionne(undefined, 1000)).toBe(1000);
  });
});
