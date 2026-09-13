import http from 'http';
import type { AddressInfo } from 'net';
import { verifierConnexion } from '../src/services/snipeIt.service';

/**
 * Ce que l'outil répond quand l'adresse ou le jeton sont faux.
 *
 * Un utilisateur qui configure une reprise se trompe presque toujours de la
 * même façon : il colle la racine du domaine alors que Snipe-IT vit dans un
 * sous-dossier, ou l'adresse d'un écran lue dans la barre du navigateur. Le
 * serveur web répond alors sa propre page 404, et la première version recopiait
 * ce HTML dans le message — « <!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01… » —
 * ce qui ne disait rien de ce qu'il fallait corriger.
 *
 * Ces tests fixent donc deux choses : le message nomme la cause et le geste, et
 * une adresse voisine qui marche est **suggérée sans être substituée**.
 * Substituer en douce ferait réussir un test sur une adresse différente de
 * celle qui sera enregistrée et réutilisée à chaque import.
 */

const PAGE_404_APACHE =
  '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">\n' +
  '<html><head>\n<title>404 Not Found</title>\n</head><body>\n<h1>Not Found</h1>\n' +
  '<p>The requested URL was not found on this server.</p>\n</body></html>';

/** Instance d'essai : `prefixe` dit sous quel chemin l'API est réellement servie. */
function serveur(options: {
  prefixe: string;
  jetonAttendu?: string;
}): Promise<{ url: string; fermer: () => void }> {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (!url.pathname.startsWith(`${options.prefixe}/api/v1`)) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(PAGE_404_APACHE);
      return;
    }

    if (options.jetonAttendu && req.headers.authorization !== `Bearer ${options.jetonAttendu}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', messages: 'Unauthorized' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: 3, rows: [] }));
  });

  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, fermer: () => srv.close() });
    });
  });
}

describe('Adresse qui ne mène pas à l’API', () => {
  let instance: Awaited<ReturnType<typeof serveur>>;

  // L'API vit sous /snipeit : pointer la racine donne la 404 du serveur web.
  beforeAll(async () => {
    instance = await serveur({ prefixe: '/snipeit' });
  });
  afterAll(() => instance.fermer());

  it('ne recopie jamais le HTML de la page d’erreur', async () => {
    const r = await verifierConnexion({ baseUrl: instance.url, token: 'peu-importe' });

    expect(r.ok).toBe(false);
    expect(r.message).not.toMatch(/DOCTYPE|<html|<h1/i);
  });

  it('nomme la cause et les gestes à faire', async () => {
    const r = await verifierConnexion({ baseUrl: instance.url, token: 'peu-importe' });

    expect(r.message).toMatch(/sous-dossier/i);
    expect(r.message).toMatch(/api\/v1\/hardware/);
  });
});

describe('Une adresse voisine qui marche est suggérée', () => {
  it('retrouve l’application servie depuis public/', async () => {
    const instance = await serveur({ prefixe: '/public' });
    try {
      const r = await verifierConnexion({ baseUrl: instance.url, token: 'x' });

      expect(r.ok).toBe(true);
      // Suggérée, pas substituée : l'écran doit la montrer et la faire accepter.
      expect(r.urlSuggeree).toBe(`${instance.url}/public`);
      expect(r.message).toMatch(/Corrigez l'adresse/i);
    } finally {
      instance.fermer();
    }
  });

  it('retire un chemin d’interface collé depuis le navigateur', async () => {
    const instance = await serveur({ prefixe: '' });
    try {
      const r = await verifierConnexion({ baseUrl: `${instance.url}/login`, token: 'x' });

      expect(r.ok).toBe(true);
      expect(r.urlSuggeree).toBe(instance.url);
    } finally {
      instance.fermer();
    }
  });

  it('ne suggère rien quand l’adresse donnée est déjà la bonne', async () => {
    const instance = await serveur({ prefixe: '' });
    try {
      const r = await verifierConnexion({ baseUrl: instance.url, token: 'x' });

      expect(r.ok).toBe(true);
      expect(r.urlSuggeree).toBeUndefined();
      expect(r.actifs).toBe(3);
    } finally {
      instance.fermer();
    }
  });
});

describe('Jeton refusé', () => {
  it('parle du jeton, pas de l’adresse', async () => {
    const instance = await serveur({ prefixe: '', jetonAttendu: 'le-bon' });
    try {
      const r = await verifierConnexion({ baseUrl: instance.url, token: 'le-mauvais' });

      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/Manage API Keys/i);
      expect(r.message).not.toMatch(/sous-dossier/i);
    } finally {
      instance.fermer();
    }
  });

  it('n’essaie pas d’autres adresses avec un jeton refusé', async () => {
    // Insister enverrait le jeton à des URL devinées : l'adresse est bonne,
    // c'est le jeton qui ne l'est pas.
    const vues: string[] = [];
    const srv = http.createServer((req, res) => {
      vues.push(req.url ?? '');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', messages: 'Unauthorized' }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as AddressInfo).port;

    try {
      await verifierConnexion({ baseUrl: `http://127.0.0.1:${port}`, token: 'mauvais' });
      // Les deux appels du premier essai (hardware + components), et rien de plus.
      expect(vues.every((u) => u.startsWith('/api/v1/'))).toBe(true);
      expect(vues.some((u) => u.includes('/public/'))).toBe(false);
    } finally {
      srv.close();
    }
  });
});

describe('Portail d’authentification devant l’application', () => {
  it('dit qu’une page web arrive au lieu de données', async () => {
    // Un SSO qui répond 200 avec sa page de connexion : le code HTTP ne dit
    // rien, seul le corps trahit le problème.
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body>Connexion SSO</body></html>');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as AddressInfo).port;

    try {
      const r = await verifierConnexion({ baseUrl: `http://127.0.0.1:${port}`, token: 'x' });

      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/portail d'authentification/i);
      expect(r.message).not.toMatch(/DOCTYPE/i);
    } finally {
      srv.close();
    }
  });
});
