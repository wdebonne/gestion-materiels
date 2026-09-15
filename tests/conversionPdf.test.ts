/**
 * Conversion d'un `.docx` en PDF par le Nextcloud de la commune.
 *
 * Ce qui casse en silence ici n'est pas le réseau — il se voit — mais la
 * *cascade* :
 *
 * - le connecteur ONLYOFFICE **refuse en JSON sous un code HTTP 200**. Se fier
 *   au statut ferait enregistrer un message d'erreur sous le nom d'un arrêté,
 *   et personne ne l'ouvrirait avant la signature ;
 * - le second chemin ne doit être tenté **que** si le premier a échoué, sans
 *   quoi chaque document coûterait deux conversions ;
 * - le `.docx` témoin doit être retiré **dans tous les cas**, y compris quand
 *   les deux chemins échouent — sinon un dossier caché se remplit d'un fichier
 *   par tentative, et personne ne pense à l'ouvrir.
 *
 * Le réseau est donc simulé : ce sont les décisions qu'on teste, pas le
 * transport.
 */

jest.mock('../src/database', () => ({
  db: {
    getType: () => 'sqlite',
    async queryOne() {
      return {
        setting_value: JSON.stringify({
          url: 'https://cloud.ville.fr/remote.php/dav/files/mairie',
          username: 'mairie',
          password: 'mot-de-passe-application',
          folder: 'Manifestations',
        }),
      };
    },
    async query() {
      return [];
    },
    async execute() {
      return { lastInsertRowid: 0, changes: 0 };
    },
  },
}));

import { convertirEnPdf } from '../src/services/conversionPdf.service';

/** Assez d'octets pour être reconnu comme un PDF, pas un de plus. */
const PDF = Buffer.from('%PDF-1.7\nun faux, mais reconnaissable\n');

const PROPFIND_FILEID = [
  '<?xml version="1.0"?>',
  '<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">',
  '<d:response>',
  '<d:href>/remote.php/dav/files/mairie/Manifestations/.conversion/temoin.docx</d:href>',
  '<d:propstat><d:prop><oc:fileid>4242</oc:fileid></d:prop>',
  '<d:status>HTTP/1.1 200 OK</d:status></d:propstat>',
  '</d:response>',
  '</d:multistatus>',
].join('');

interface Appel {
  methode: string;
  url: string;
}

let appels: Appel[] = [];

/** Une réponse `fetch` réduite à ce que le service en lit. */
function repondre(corps: string | Buffer, status = 200) {
  const octets = Buffer.isBuffer(corps) ? corps : Buffer.from(corps, 'utf8');

  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return octets.toString('utf8');
    },
    async arrayBuffer() {
      return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength);
    },
  } as any;
}

/**
 * Le dépôt, l'identifiant et le retrait, qui se passent de la même façon dans
 * tous les cas : seule la conversion elle-même change d'un scénario à l'autre.
 */
function socle(appel: Appel) {
  if (appel.methode === 'MKCOL' || appel.methode === 'PUT') return repondre('', 201);
  if (appel.methode === 'PROPFIND') return repondre(PROPFIND_FILEID);
  if (appel.methode === 'DELETE') return repondre('', 204);
  return null;
}

function brancher(routeur: (appel: Appel) => any) {
  appels = [];
  (global as any).fetch = jest.fn(async (url: any, options: any = {}) => {
    const appel: Appel = { methode: options.method ?? 'GET', url: String(url) };
    appels.push(appel);
    return socle(appel) ?? routeur(appel);
  });
}

const vise = (fragment: string) => appels.filter((a) => a.url.includes(fragment));
const parMethode = (methode: string) => appels.filter((a) => a.methode === methode);

afterEach(() => {
  delete (global as any).fetch;
});

describe('le connecteur ONLYOFFICE, essayé en premier', () => {
  it("rend le PDF et n'appelle pas le second chemin", async () => {
    brancher((appel) => (appel.url.includes('/downloadas') ? repondre(PDF) : repondre('', 404)));

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(true);
    expect(resultat.methode).toBe('connecteur ONLYOFFICE');
    expect(resultat.pdf?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Deux conversions par document coûteraient le double sans rien apporter.
    expect(vise('/api/v1/convert')).toHaveLength(0);
  });

  it('convertit le fichier déposé, désigné par son identifiant', async () => {
    brancher((appel) => (appel.url.includes('/downloadas') ? repondre(PDF) : repondre('', 404)));

    await convertirEnPdf(Buffer.from('un .docx'));

    expect(vise('fileId=4242')).toHaveLength(1);
    expect(vise('toExtension=pdf')).toHaveLength(1);
  });

  it("passe au chemin suivant quand il refuse en JSON sous un code 200", async () => {
    brancher((appel) => {
      if (appel.url.includes('/downloadas')) {
        // C'est ainsi que le connecteur dit non : 200, et du JSON.
        return repondre(JSON.stringify({ error: 'FileNotFound' }));
      }
      if (appel.url.includes('/api/v1/convert')) {
        return repondre(
          JSON.stringify({ ocs: { data: { path: '/Manifestations/.conversion/abc.pdf' } } }),
          201
        );
      }
      return repondre(PDF);
    });

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(true);
    expect(resultat.methode).toBe('API de conversion Nextcloud');
  });
});

describe("l'API de conversion Nextcloud, en second", () => {
  const brancherSecondChemin = (reponseConvert: any) =>
    brancher((appel) => {
      if (appel.url.includes('/downloadas')) return repondre('', 404);
      if (appel.url.includes('/api/v1/convert')) return reponseConvert;
      return repondre(PDF);
    });

  it('relit puis retire le PDF qu’elle a écrit dans le compte', async () => {
    brancherSecondChemin(
      repondre(JSON.stringify({ ocs: { data: { path: '/Manifestations/.conversion/abc.pdf' } } }), 201)
    );

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(true);
    expect(vise('abc.pdf').map((a) => a.methode)).toEqual(['GET', 'DELETE']);
  });

  it("rend la phrase du serveur quand aucune application ne sait convertir", async () => {
    brancherSecondChemin(
      repondre(JSON.stringify({ ocs: { meta: { message: 'No conversion provider' } } }), 400)
    );

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(false);
    expect(resultat.error).toContain('No conversion provider');
  });
});

describe('quand les deux chemins échouent', () => {
  const brancherEchecTotal = () =>
    brancher((appel) =>
      appel.url.includes('/downloadas')
        ? repondre('', 404)
        : repondre(JSON.stringify({ ocs: { meta: { message: 'No conversion provider' } } }), 400)
    );

  it('nomme les deux tentatives, pour savoir laquelle corriger', async () => {
    brancherEchecTotal();

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(false);
    expect(resultat.pdf).toBeUndefined();
    expect(resultat.error).toContain('connecteur ONLYOFFICE');
    expect(resultat.error).toContain('API de conversion Nextcloud');
  });

  it('retire quand même le document témoin', async () => {
    brancherEchecTotal();

    await convertirEnPdf(Buffer.from('un .docx'));

    // Sans ce retrait, un échec laisserait un fichier par tentative dans un
    // dossier caché que personne n'ouvre.
    expect(parMethode('DELETE')).toHaveLength(1);
    expect(parMethode('DELETE')[0].url).toContain('.conversion');
  });
});

describe('quand le dépôt lui-même est refusé', () => {
  it("ne tente aucune conversion et dit que c'est le dépôt", async () => {
    appels = [];
    (global as any).fetch = jest.fn(async (url: any, options: any = {}) => {
      appels.push({ methode: options.method ?? 'GET', url: String(url) });
      return repondre('', 401);
    });

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(false);
    expect(resultat.error).toContain('dépôt du document à convertir refusé');
    expect(vise('/downloadas')).toHaveLength(0);
    expect(vise('/api/v1/convert')).toHaveLength(0);
  });
});
