/**
 * Conversion d'un `.docx` en PDF par le Nextcloud de la commune.
 *
 * Ce qui casse en silence ici n'est pas le réseau — il se voit — mais la
 * *cascade* :
 *
 * - **l'identifiant de l'application**. Euro-Office est un fork d'ONLYOFFICE
 *   Docs, mais son connecteur Nextcloud est une application distincte :
 *   `eurooffice`, non `onlyoffice`. Interroger le mauvais identifiant rend un
 *   404 qu'on lirait comme « pas de serveur bureautique », alors qu'il y en a
 *   un ;
 * - le connecteur **refuse en JSON sous un code HTTP 200**, ou par une page
 *   d'erreur HTML. Se fier au statut ferait enregistrer un message d'erreur
 *   sous le nom d'un arrêté, et personne ne l'ouvrirait avant la signature ;
 * - un chemin ne doit être tenté **que** si le précédent a échoué, sans quoi
 *   chaque document coûterait plusieurs conversions ;
 * - le `.docx` témoin doit être retiré **dans tous les cas**, y compris quand
 *   tous les chemins échouent — sinon un dossier caché se remplit d'un fichier
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

/** La route d'un connecteur donné, identifiant d'application compris. */
const connecteur = (appel: Appel, app: string) =>
  appel.url.includes(`/apps/${app}/downloadas`);

const vise = (fragment: string) => appels.filter((a) => a.url.includes(fragment));
const parMethode = (methode: string) => appels.filter((a) => a.methode === methode);

/** Réponse de l'API Nextcloud quand aucune application ne sait convertir. */
const SANS_FOURNISSEUR = () =>
  repondre(
    JSON.stringify({ ocs: { meta: { message: "Le fichier n'a pas pu être converti" } } }),
    500
  );

afterEach(() => {
  delete (global as any).fetch;
});

describe("l'identifiant de l'application du connecteur", () => {
  it('essaie Euro-Office en premier, et rien de plus quand il répond', async () => {
    brancher((appel) => (connecteur(appel, 'eurooffice') ? repondre(PDF) : repondre('', 404)));

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(true);
    expect(resultat.methode).toBe('connecteur Euro-Office');
    // Plusieurs conversions par document coûteraient autant de fois plus sans
    // rien apporter.
    expect(vise('/apps/onlyoffice/')).toHaveLength(0);
    expect(vise('/api/v1/convert')).toHaveLength(0);
  });

  it("bascule sur l'autre identifiant quand la première application est absente", async () => {
    // C'est le cas réel qui a motivé la liste : une instance où le serveur
    // bureautique est bien là, mais sous le nom du fork. Interroger le seul
    // `onlyoffice` rendait un 404 qu'on aurait lu comme « pas de conversion
    // possible ».
    brancher((appel) => (connecteur(appel, 'onlyoffice') ? repondre(PDF) : repondre('', 404)));

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(true);
    expect(resultat.methode).toBe('connecteur ONLYOFFICE');
    expect(vise('/apps/eurooffice/downloadas')).toHaveLength(1);
  });

  it('convertit le fichier déposé, désigné par son identifiant', async () => {
    brancher((appel) => (connecteur(appel, 'eurooffice') ? repondre(PDF) : repondre('', 404)));

    await convertirEnPdf(Buffer.from('un .docx'));

    expect(vise('fileId=4242')).toHaveLength(1);
    expect(vise('toExtension=pdf')).toHaveLength(1);
  });
});

describe('le refus déguisé en succès', () => {
  it("passe au chemin suivant quand un connecteur refuse en JSON sous un code 200", async () => {
    brancher((appel) => {
      // C'est ainsi que le connecteur dit non : 200, et du JSON.
      if (connecteur(appel, 'eurooffice')) return repondre(JSON.stringify({ error: 'FileNotFound' }));
      if (connecteur(appel, 'onlyoffice')) return repondre(PDF);
      return repondre('', 404);
    });

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(true);
    expect(resultat.methode).toBe('connecteur ONLYOFFICE');
  });

  it("ne prend pas une page d'erreur HTML pour un PDF", async () => {
    brancher((appel) =>
      connecteur(appel, 'eurooffice')
        ? repondre('<!DOCTYPE html><html><body>Not permitted</body></html>')
        : repondre('', 404)
    );

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(false);
    expect(resultat.pdf).toBeUndefined();
  });
});

describe("l'API de conversion Nextcloud, en dernier recours", () => {
  const brancherApi = (reponseConvert: any) =>
    brancher((appel) => {
      if (appel.url.includes('/downloadas')) return repondre('', 404);
      if (appel.url.includes('/api/v1/convert')) return reponseConvert;
      return repondre(PDF);
    });

  it('relit puis retire le PDF qu’elle a écrit dans le compte', async () => {
    brancherApi(
      repondre(JSON.stringify({ ocs: { data: { path: '/Manifestations/.conversion/abc.pdf' } } }), 201)
    );

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(true);
    expect(resultat.methode).toBe('API de conversion Nextcloud');
    expect(vise('abc.pdf').map((a) => a.methode)).toEqual(['GET', 'DELETE']);
  });

  it("rend la phrase du serveur quand aucune application ne sait convertir", async () => {
    brancherApi(SANS_FOURNISSEUR());

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(false);
    expect(resultat.error).toContain("Le fichier n'a pas pu être converti");
  });
});

describe('quand aucun chemin nʼaboutit', () => {
  const brancherEchecTotal = () =>
    brancher((appel) =>
      appel.url.includes('/downloadas') ? repondre('', 404) : SANS_FOURNISSEUR()
    );

  it('nomme les trois tentatives, pour savoir laquelle corriger', async () => {
    brancherEchecTotal();

    const resultat = await convertirEnPdf(Buffer.from('un .docx'));

    expect(resultat.success).toBe(false);
    expect(resultat.pdf).toBeUndefined();
    // L'administrateur doit pouvoir distinguer « l'application n'est pas
    // installée » de « elle est là mais refuse ».
    expect(resultat.error).toContain('connecteur Euro-Office');
    expect(resultat.error).toContain('connecteur ONLYOFFICE');
    expect(resultat.error).toContain('API de conversion Nextcloud');
    expect(resultat.error).toContain('eurooffice');
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
