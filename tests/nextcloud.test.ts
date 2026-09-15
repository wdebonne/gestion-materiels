/**
 * Connexion et exploration d'un Nextcloud.
 *
 * Trois choses se cassent en silence ici, et aucune ne se voit à l'exécution :
 *
 * - **l'adresse**, parce que la racine WebDAV attendue ne s'affiche nulle part
 *   dans Nextcloud et que ce qu'on recopie est l'adresse du site ;
 * - **le chemin**, encodé par le serveur et décodé par nous — « Fête » revient
 *   en `F%C3%AAte`, et un dossier mal nommé n'existe simplement pas ;
 * - **le préfixe de domaine du XML**, `d:` chez les uns et `D:` ou `lp1:` chez
 *   les autres, qui rend un dossier vide au lieu de lever une erreur.
 *
 * Le reste — le dépôt, la lecture — passe par le réseau et ne se teste pas ici.
 */

jest.mock('../src/database', () => ({
  db: {
    getType: () => 'sqlite',
    async query() {
      return [];
    },
    async queryOne() {
      return null;
    },
    async execute() {
      return { lastInsertRowid: 0, changes: 0 };
    },
  },
}));

import {
  analyserPropfind,
  construireUrl,
  normaliserChemin,
  normaliserUrl,
  racineInstance,
} from '../src/services/webdav.service';

const RACINE = 'https://cloud.ville.fr/remote.php/dav/files/mairie';

describe("l'adresse du serveur", () => {
  it("complète l'adresse du site en racine WebDAV", () => {
    expect(normaliserUrl('https://cloud.ville.fr', 'mairie')).toBe(RACINE);
  });

  it('accepte une adresse sans protocole', () => {
    expect(normaliserUrl('cloud.ville.fr', 'mairie')).toBe(RACINE);
  });

  it("laisse intacte une racine WebDAV déjà complète", () => {
    expect(normaliserUrl(RACINE, 'mairie')).toBe(RACINE);
    expect(normaliserUrl(`${RACINE}/`, 'mairie')).toBe(RACINE);
  });

  it("ne réécrit pas un remote.php d'ancienne génération", () => {
    const ancien = 'https://cloud.ville.fr/remote.php/webdav';
    expect(normaliserUrl(ancien, 'mairie')).toBe(ancien);
  });

  it("retire l'écran recopié depuis le navigateur", () => {
    expect(normaliserUrl('https://cloud.ville.fr/apps/files/?dir=/Manifestations', 'mairie')).toBe(
      RACINE
    );
    expect(normaliserUrl('https://cloud.ville.fr/index.php/apps/files', 'mairie')).toBe(RACINE);
  });

  it("garde un Nextcloud servi dans un sous-répertoire", () => {
    expect(normaliserUrl('https://www.ville.fr/nuage', 'mairie')).toBe(
      'https://www.ville.fr/nuage/remote.php/dav/files/mairie'
    );
  });

  it("encode un identifiant qui ne s'écrit pas en ASCII", () => {
    expect(normaliserUrl('https://cloud.ville.fr', 'mairie pavilly')).toBe(
      'https://cloud.ville.fr/remote.php/dav/files/mairie%20pavilly'
    );
  });
});

describe("la racine de l'instance", () => {
  // L'API OCS et les routes d'application ne vivent pas sous la racine WebDAV.
  // S'y tromper donnerait un 404 muet, indiscernable d'une application absente.
  it('retire la partie WebDAV', () => {
    expect(racineInstance(RACINE)).toBe('https://cloud.ville.fr');
  });

  it('garde le sous-répertoire quand Nextcloud y est installé', () => {
    expect(racineInstance('https://serveur.ville.fr/nextcloud/remote.php/dav/files/mairie')).toBe(
      'https://serveur.ville.fr/nextcloud'
    );
  });

  it("respecte un remote.php/webdav d'ancienne génération", () => {
    expect(racineInstance('https://cloud.ville.fr/remote.php/webdav')).toBe(
      'https://cloud.ville.fr'
    );
  });

  it('laisse une adresse déjà nue telle quelle', () => {
    expect(racineInstance('https://cloud.ville.fr/')).toBe('https://cloud.ville.fr');
  });
});

describe('les chemins', () => {
  it('garde le nom lisible, encodé segment par segment', () => {
    expect(construireUrl(RACINE, 'Manifestations', 'Fête de la musique.xlsx')).toBe(
      `${RACINE}/Manifestations/F%C3%AAte%20de%20la%20musique.xlsx`
    );
  });

  it('ne double pas les barres', () => {
    expect(construireUrl('https://cloud.ville.fr/dav/', '/Manifestations/', 'suivi.xlsx')).toBe(
      'https://cloud.ville.fr/dav/Manifestations/suivi.xlsx'
    );
  });

  it("refuse la remontée : fetch normalise le chemin avant de l'envoyer", () => {
    expect(construireUrl(RACINE, '../../autre', 'vol.txt')).toBe(`${RACINE}/autre/vol.txt`);
    expect(normaliserChemin('../Manifestations/./2026')).toBe('Manifestations/2026');
    expect(normaliserChemin(null)).toBe('');
  });
});

/** Une réponse telle que la sert Nextcloud, préfixes de domaine compris. */
const REPONSE = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/mairie/Manifestations/</d:href>
    <d:propstat>
      <d:prop>
        <d:getlastmodified>Mon, 14 Sep 2026 08:00:00 GMT</d:getlastmodified>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/mairie/Manifestations/suivi.xlsx</d:href>
    <d:propstat>
      <d:prop>
        <d:getlastmodified>Mon, 14 Sep 2026 09:30:00 GMT</d:getlastmodified>
        <d:getcontentlength>20480</d:getcontentlength>
        <d:getcontenttype>application/vnd.openxmlformats-officedocument.spreadsheetml.sheet</d:getcontenttype>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <D:response>
    <D:href>/remote.php/dav/files/mairie/Manifestations/F%C3%AAte%20de%20la%20musique/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</d:multistatus>`;

describe('le contenu d’un dossier', () => {
  const entrees = analyserPropfind(REPONSE, RACINE, 'Manifestations');

  it('écarte le dossier interrogé, qui figure dans sa propre réponse', () => {
    expect(entrees.map((e) => e.nom)).not.toContain('Manifestations');
    expect(entrees).toHaveLength(2);
  });

  it('range les dossiers avant les fichiers', () => {
    expect(entrees.map((e) => e.nom)).toEqual(['Fête de la musique', 'suivi.xlsx']);
  });

  it('rend le nom lisible, et le chemin relatif à la racine du compte', () => {
    const dossier = entrees[0];
    expect(dossier.dossier).toBe(true);
    expect(dossier.chemin).toBe('Manifestations/Fête de la musique');
    expect(dossier.taille).toBeUndefined();
  });

  it('lit la taille, la date et le type du fichier', () => {
    const fichier = entrees[1];
    expect(fichier.dossier).toBe(false);
    expect(fichier.taille).toBe(20480);
    expect(fichier.modifie).toBe('2026-09-14T09:30:00.000Z');
    expect(fichier.typeMime).toContain('spreadsheetml');
  });

  it('accepte un href absolu, que certains serveurs renvoient', () => {
    const absolu = REPONSE.replace(
      /<d:href>\/remote/g,
      '<d:href>https://cloud.ville.fr/remote'
    );
    expect(analyserPropfind(absolu, RACINE, 'Manifestations').map((e) => e.nom)).toEqual([
      'Fête de la musique',
      'suivi.xlsx',
    ]);
  });

  it("ne rend pas un dossier vide quand le préfixe de domaine change", () => {
    const autrePrefixe = REPONSE.replace(/d:/g, 'lp1:').replace(/D:/g, 'lp1:');
    expect(analyserPropfind(autrePrefixe, RACINE, 'Manifestations')).toHaveLength(2);
  });
});
