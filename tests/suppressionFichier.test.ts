import fs from 'fs';
import path from 'path';
import { resoudreSous } from '../src/utils/cheminSous';

/**
 * Suppression de fichier arbitraire, dans ses deux formes.
 *
 * 1. `DELETE /api/upload/:filename` joignait le nom reçu au dossier des
 *    uploads sans le normaliser. `..%2Fdata%2FTEMOIN.txt` a rendu 200 et
 *    supprimé le fichier ; `..%2Fdata%2Fdatabase.sqlite` aurait détruit la
 *    base. Réservé au superviseur, c'est-à-dire à l'agent qui gère le parc.
 *
 * 2. Pire, et trouvé en corrigeant la première : `PUT /api/auth/profile`
 *    recopiait le champ `avatar` du corps de la requête dans la fiche du
 *    compte, et `DELETE /api/auth/avatar` supprimait ensuite le fichier ainsi
 *    désigné. Aucune remontée n'était nécessaire — le chemin étant joint à la
 *    racine du projet, `data/audit_temoin/temoin.txt` a suffi — et le rôle
 *    `user`, en consultation seule, y parvenait. Vérifié en conditions réelles.
 *
 * Le correctif tient en un point de passage unique, `resoudreSous`, et en un
 * retrait : le profil n'écrit plus l'avatar, que seul `POST /api/auth/avatar`
 * fixe désormais, à partir du fichier réellement reçu.
 */

const RACINE = path.join(process.cwd(), 'uploads');

describe('resoudreSous : ce qui sort de la racine est refusé', () => {
  const HORS_RACINE = [
    '../data/database.sqlite',
    '..',
    '../',
    '.',
    './',
    'images/../../data/database.sqlite',
    '../uploads-anciens/photo.jpg',
    '..\\data\\database.sqlite',
    '',
    '   ',
  ];

  it.each(HORS_RACINE)('refuse « %s »', (chemin) => {
    expect(resoudreSous(RACINE, chemin)).toBeNull();
  });

  it('refuse un chemin absolu, que `path.resolve` ferait gagner', () => {
    expect(resoudreSous(RACINE, path.resolve(process.cwd(), 'data', 'database.sqlite'))).toBeNull();
    expect(resoudreSous(RACINE, '/etc/passwd')).toBeNull();
  });

  it('refuse un dossier voisin dont le nom commence pareil', () => {
    // Sans le séparateur ajouté à la racine, `uploads-anciens` passait pour un
    // enfant de `uploads`.
    expect(resoudreSous(RACINE, path.join('..', 'uploads-anciens', 'x.jpg'))).toBeNull();
  });

  it('refuse ce qui n’est pas une chaîne', () => {
    for (const valeur of [null, undefined, 42, {}, []]) {
      expect(resoudreSous(RACINE, valeur)).toBeNull();
    }
  });
});

describe('resoudreSous : ce qui reste dedans est accepté', () => {
  it('accepte un fichier à la racine du dossier', () => {
    expect(resoudreSous(RACINE, 'photo.jpg')).toBe(path.join(RACINE, 'photo.jpg'));
  });

  it('accepte un sous-dossier, où `handleUpload` range images et documents', () => {
    expect(resoudreSous(RACINE, 'images/photo.jpg')).toBe(path.join(RACINE, 'images', 'photo.jpg'));
    expect(resoudreSous(RACINE, 'documents/arrete.pdf')).toBe(path.join(RACINE, 'documents', 'arrete.pdf'));
  });

  it('accepte un détour qui revient dans la racine', () => {
    expect(resoudreSous(RACINE, 'images/../photo.jpg')).toBe(path.join(RACINE, 'photo.jpg'));
  });
});

describe('Les routes qui suppriment un fichier passent par le garde', () => {
  const lire = (...bouts: string[]) =>
    fs.readFileSync(path.join(__dirname, '..', ...bouts), 'utf8');

  const upload = lire('src', 'routes', 'upload.routes.ts');
  const auth = lire('src', 'routes', 'auth.routes.ts');

  it('DELETE /api/upload/:filename résout avant de supprimer', () => {
    const debut = upload.indexOf("router.delete('/:filename'");
    expect(debut).toBeGreaterThan(-1);

    const handler = upload.slice(debut, upload.indexOf('unlinkSync', debut));
    expect(handler).toMatch(/resoudreSous\(/);
    expect(handler).not.toMatch(/path\.join\(__dirname, '\.\.\/\.\.\/uploads', filename\)/);
  });

  it('PUT /api/auth/profile n’écrit plus l’avatar', () => {
    const debut = auth.indexOf("router.put('/profile'");
    expect(debut).toBeGreaterThan(-1);

    const handler = auth.slice(debut, auth.indexOf('router.', debut + 10));
    expect(handler).not.toMatch(/avatar = \?/);
    expect(handler).not.toMatch(/const \{[^}]*\bavatar\b[^}]*\} = req\.body/);
  });

  it('aucune suppression d’avatar ne part de la racine du projet', () => {
    // La forme d'origine : `path.join(__dirname, '../../', <valeur en base>)`.
    expect(auth).not.toMatch(/path\.join\(__dirname, '\.\.\/\.\.\/',\s*currentUser\.avatar/);
    const gardes = auth.match(/resoudreSous\(/g) ?? [];
    expect(gardes.length).toBeGreaterThanOrEqual(2);
  });
});
