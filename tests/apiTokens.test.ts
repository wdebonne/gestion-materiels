import {
  permissionRequise,
  lirePermissions,
  PERMISSIONS_TOKEN,
  type PermissionToken,
} from '../src/middleware/auth.middleware';

/**
 * Portée des tokens API.
 *
 * Les permissions d'un token étaient analysées puis rangées dans la requête, et
 * plus rien ne les lisait : un token créé « lecture seule » par un administrateur
 * pouvait supprimer tout ce que son créateur pouvait supprimer. L'écran des
 * tokens affichait pourtant trois cases distinctes.
 *
 * Le découpage figé ici est celui que cet écran promet à l'administrateur :
 * lecture pour GET, écriture pour POST/PUT, suppression pour DELETE.
 */

describe('Permission exigée par méthode HTTP', () => {
  it('associe chaque méthode à la permission annoncée dans l’écran des tokens', () => {
    const attendu: Record<string, PermissionToken> = {
      GET: 'read',
      HEAD: 'read',
      OPTIONS: 'read',
      POST: 'write',
      PUT: 'write',
      PATCH: 'write',
      DELETE: 'delete',
    };

    for (const [methode, permission] of Object.entries(attendu)) {
      expect(permissionRequise(methode)).toBe(permission);
    }
  });

  it('accepte une méthode en minuscules', () => {
    expect(permissionRequise('get')).toBe('read');
    expect(permissionRequise('delete')).toBe('delete');
  });

  it('traite une méthode inconnue comme une écriture', () => {
    // Ne jamais élargir par défaut : une méthode non prévue ne doit pas
    // retomber sur « lecture », que tous les tokens possèdent.
    expect(permissionRequise('PURGE')).toBe('write');
  });
});

describe('Lecture des permissions stockées', () => {
  it('rend les permissions accordées', () => {
    expect(lirePermissions('["read","write"]')).toEqual(['read', 'write']);
    expect(lirePermissions(['read', 'write', 'delete'])).toEqual(['read', 'write', 'delete']);
  });

  it('retombe sur la lecture seule quand la valeur est inutilisable', () => {
    // Colonne vide, JSON corrompu, type inattendu : la panne ne doit pas
    // ouvrir de droits qu'aucun administrateur n'a accordés.
    for (const brut of [null, undefined, '', 'pas du json', '{}', '42', [], '[]']) {
      expect(lirePermissions(brut)).toEqual(['read']);
    }
  });

  it('écarte les permissions inventées', () => {
    expect(lirePermissions('["read","admin","*"]')).toEqual(['read']);
    expect(lirePermissions('["write","root"]')).toEqual(['write']);
  });

  it('ne connaît que les trois permissions proposées', () => {
    // Ajouter une permission côté écran sans la traiter ici la rendrait
    // silencieusement inopérante.
    expect([...PERMISSIONS_TOKEN]).toEqual(['read', 'write', 'delete']);
  });
});

describe('Ce qu’un token peut faire', () => {
  const autorise = (permissions: unknown, methode: string) =>
    lirePermissions(permissions).includes(permissionRequise(methode));

  it('un token lecture seule ne peut ni écrire ni supprimer', () => {
    expect(autorise('["read"]', 'GET')).toBe(true);
    expect(autorise('["read"]', 'POST')).toBe(false);
    expect(autorise('["read"]', 'PUT')).toBe(false);
    expect(autorise('["read"]', 'DELETE')).toBe(false);
  });

  it('un token lecture + écriture ne peut pas supprimer', () => {
    expect(autorise('["read","write"]', 'POST')).toBe(true);
    expect(autorise('["read","write"]', 'DELETE')).toBe(false);
  });

  it('un token complet peut tout', () => {
    for (const m of ['GET', 'POST', 'PUT', 'DELETE']) {
      expect(autorise('["read","write","delete"]', m)).toBe(true);
    }
  });
});
