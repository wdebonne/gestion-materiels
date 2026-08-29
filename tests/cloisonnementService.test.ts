import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import { cheminAutorise, refuserSiCloisonne, REFUS_CLOISONNEMENT } from '../src/middleware/cloisonnementService';

/**
 * Cloisonnement du rôle « service » au seul module Manifestations.
 *
 * Le service communication suit les manifestations ; il n'a pas à voir le parc,
 * les entretiens, les pleins de carburant ni les espaces verts. La règle est
 * **fermée par défaut** : tout ce qui n'est pas explicitement ouvert est refusé,
 * pour qu'une route ajoutée demain ne s'ouvre pas toute seule.
 *
 * Ces tests protègent aussi un piège qui a coûté une correction : dans un
 * routeur monté, `req.path` est relatif au point de montage — `/5` et non
 * `/api/objects/5`. Comparer la liste blanche à `req.path` ne reconnaîtrait
 * plus rien et refuserait tout, manifestations comprises.
 */

describe('Ce qui reste ouvert', () => {
  it.each([
    ['/api/manifestations', 'GET'],
    ['/api/manifestations/12', 'GET'],
    ['/api/manifestations/12/messages', 'POST'],
    ['/api/manifestations/12/approvals/3', 'PUT'],
    ['/api/manifestations/stock', 'GET'],
  ])('%s %s', (chemin, methode) => {
    expect(cheminAutorise(chemin, methode)).toBe(true);
  });

  it('laisse passer la connexion, sans quoi le compte ne pourrait pas entrer', () => {
    expect(cheminAutorise('/api/auth/login', 'POST')).toBe(true);
    expect(cheminAutorise('/api/auth/refresh', 'POST')).toBe(true);
  });

  it('laisse lire ce dont la mise en page a besoin', () => {
    // Refuser ces lectures afficherait une erreur à chaque chargement de page.
    for (const chemin of ['/api/settings', '/api/categories', '/api/alerts', '/api/services/mine']) {
      expect(cheminAutorise(chemin, 'GET')).toBe(true);
    }
  });

  it('ignore la chaîne de requête', () => {
    expect(cheminAutorise('/api/manifestations?status=pending', 'GET')).toBe(true);
  });

  it('laisse passer le dépôt d’une demande, qui n’exige aucun compte', () => {
    expect(cheminAutorise('/api/manifestations/intake/formulaire', 'POST')).toBe(true);
  });
});

describe('Ce qui est refusé', () => {
  it.each([
    ['/api/objects', 'GET'],
    ['/api/objects/5', 'GET'],
    ['/api/green-spaces', 'GET'],
    ['/api/tracking', 'GET'],
    ['/api/users', 'GET'],
    ['/api/logs', 'GET'],
    ['/api/backup', 'GET'],
    ['/api/webhooks', 'GET'],
    ['/api/import-export/export', 'GET'],
    ['/api/reservations', 'GET'],
  ])('%s %s', (chemin, methode) => {
    expect(cheminAutorise(chemin, methode)).toBe(false);
  });

  it('refuse d’écrire là où seule la lecture est ouverte', () => {
    // Lire le nom du site est nécessaire ; le changer ne l'est pas.
    expect(cheminAutorise('/api/settings', 'PUT')).toBe(false);
    expect(cheminAutorise('/api/categories', 'POST')).toBe(false);
    expect(cheminAutorise('/api/services/3', 'PUT')).toBe(false);
    expect(cheminAutorise('/api/alerts/read-all', 'PUT')).toBe(false);
  });

  it('refuse une route inconnue : la règle est fermée par défaut', () => {
    // C'est la propriété qui compte : une route ajoutée demain est refusée
    // tant que quelqu'un n'a pas décidé du contraire.
    expect(cheminAutorise('/api/nouvelle-fonctionnalite', 'GET')).toBe(false);
  });

  it('ne se laisse pas tromper par un préfixe qui ressemble', () => {
    // `/api/objects-secrets` ne doit pas passer parce qu'il commence comme un
    // chemin autorisé, et `/api/manifestationsXYZ` non plus.
    expect(cheminAutorise('/api/manifestationsXYZ', 'GET')).toBe(false);
    expect(cheminAutorise('/api/settings-avances', 'GET')).toBe(false);
  });
});

describe('Application de la règle', () => {
  const fausseReponse = () => {
    let code: number | undefined;
    let corps: any;
    const res = {
      status(c: number) {
        code = c;
        return this;
      },
      json(j: any) {
        corps = j;
        return this;
      },
    } as unknown as Response;
    return { res, lu: () => ({ code, corps }) };
  };

  const requete = (originalUrl: string, method = 'GET') =>
    ({ originalUrl, method, path: '/' } as Request);

  it('laisse passer les autres rôles sans rien regarder', () => {
    for (const role of ['admin', 'supervisor', 'agent', 'user']) {
      const { res, lu } = fausseReponse();
      expect(refuserSiCloisonne(requete('/api/objects'), res, role)).toBe(false);
      expect(lu().code).toBeUndefined();
    }
  });

  it('refuse un compte « service » hors périmètre, avec un message explicite', () => {
    const { res, lu } = fausseReponse();

    expect(refuserSiCloisonne(requete('/api/objects/5'), res, 'service')).toBe(true);
    expect(lu().code).toBe(403);
    expect(lu().corps).toEqual({ success: false, message: REFUS_CLOISONNEMENT });
  });

  it('laisse passer un compte « service » sur les manifestations', () => {
    const { res, lu } = fausseReponse();

    expect(refuserSiCloisonne(requete('/api/manifestations/7/messages', 'POST'), res, 'service')).toBe(false);
    expect(lu().code).toBeUndefined();
  });

  it('lit le chemin complet, jamais celui du routeur monté', () => {
    // `req.path` vaut `/5` dans un routeur monté sur `/api/objects` : s'y fier
    // ferait échouer la reconnaissance et refuserait absolument tout.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'middleware', 'cloisonnementService.ts'),
      'utf8'
    );
    const debut = source.indexOf('export function refuserSiCloisonne');
    const corps = source.slice(debut, source.indexOf('\n}', debut));

    expect(corps).toContain('req.originalUrl');
    expect(corps).not.toMatch(/cheminAutorise\(req\.path/);
  });
});

describe('Point d’application unique', () => {
  it('est branché dans l’authentification, où le rôle devient connu', () => {
    // L'authentification est posée route par route dans ce projet : un
    // middleware global monté avant les routes verrait toujours `req.user`
    // indéfini et laisserait tout passer.
    const auth = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'middleware', 'auth.middleware.ts'),
      'utf8'
    );

    expect(auth).toContain('refuserSiCloisonne');
    // Les deux voies d'entrée doivent l'appeler : jeton de session et jeton API.
    // Sans la seconde, un token API créé par un compte « service » contournerait
    // tout le cloisonnement.
    expect(auth.match(/refuserSiCloisonne\(/g)?.length).toBe(2);
  });
});
