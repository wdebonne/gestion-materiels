import { dateOuNull, nombreOuNull } from '../src/utils/valeursSql';
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
