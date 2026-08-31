import type { Response } from 'express';
import {
  requireRole,
  requireAdmin,
  requireSupervisor,
  requireFieldWrite,
  type AuthRequest,
  type RoleGuard,
} from '../src/middleware/auth.middleware';
import { ROLES, CONFIGURABLE_ROLES, isRole, type Role } from '../src/config/roles';

/**
 * Filet de sécurité du modèle de rôles.
 *
 * L'ouverture des écritures de terrain au rôle « agent » se joue sur quelques
 * lignes réparties dans plusieurs fichiers de routes. Ces tests figent qui a le
 * droit de faire quoi, pour qu'un endpoint ne s'ouvre jamais par accident.
 */

// ---------------------------------------------------------------- utilitaires

function runGuard(guard: RoleGuard, role: Role | undefined) {
  const req = { user: role ? { userId: 1, email: 'x@y.fr', role } : undefined } as AuthRequest;

  let status: number | undefined;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;

  let passed = false;
  guard(req, res, () => {
    passed = true;
  });

  return { passed, status };
}

/** Récupère les rôles autorisés sur une route donnée d'un routeur Express. */
function allowedRolesFor(router: any, method: string, path: string): readonly string[] | null {
  const layer = router.stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method.toLowerCase()]
  );

  if (!layer) return null;

  const guard = layer.route.stack
    .map((s: any) => s.handle)
    .find((h: any) => Array.isArray(h?.allowedRoles));

  return guard ? guard.allowedRoles : null;
}

// ---------------------------------------------------------------- le référentiel

describe('Référentiel des rôles', () => {
  it('contient les cinq rôles', () => {
    // Les quatre premiers vont du plus large au plus restreint. `service` est
    // à part : un accès latéral au seul module Manifestations, qui y écrit sans
    // rien voir du parc.
    expect(ROLES).toEqual(['admin', 'supervisor', 'agent', 'user', 'service']);
  });

  it("exclut l'administrateur des rôles configurables (il a tout par construction)", () => {
    expect(CONFIGURABLE_ROLES).not.toContain('admin');
    expect(CONFIGURABLE_ROLES).toEqual(['supervisor', 'agent', 'user', 'service']);
  });

  it('reconnaît les rôles valides et rejette le reste', () => {
    expect(isRole('agent')).toBe(true);
    expect(isRole('root')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------- les gardes

describe('Gardes de rôle', () => {
  const matrice: Array<{ nom: string; guard: RoleGuard; autorises: Role[] }> = [
    { nom: 'requireAdmin', guard: requireAdmin, autorises: ['admin'] },
    { nom: 'requireSupervisor', guard: requireSupervisor, autorises: ['admin', 'supervisor'] },
    { nom: 'requireFieldWrite', guard: requireFieldWrite, autorises: ['admin', 'supervisor', 'agent'] },
  ];

  describe.each(matrice)('$nom', ({ guard, autorises }) => {
    it.each(ROLES)('rôle %s', (role) => {
      const attendu = autorises.includes(role);
      const { passed, status } = runGuard(guard, role);

      expect(passed).toBe(attendu);
      if (!attendu) expect(status).toBe(403);
    });

    it('refuse une requête non authentifiée avec un 401', () => {
      const { passed, status } = runGuard(guard, undefined);
      expect(passed).toBe(false);
      expect(status).toBe(401);
    });
  });

  it("n'autorise jamais un rôle inconnu", () => {
    const { passed, status } = runGuard(requireFieldWrite, 'root' as Role);
    expect(passed).toBe(false);
    expect(status).toBe(403);
  });

  it('expose les rôles autorisés pour permettre la vérification des routes', () => {
    expect(requireRole('admin', 'agent').allowedRoles).toEqual(['admin', 'agent']);
  });
});

// ---------------------------------------------------------------- le contrat des routes

describe('Contrat des routes', () => {
  const objectRoutes = require('../src/routes/object.routes').default;
  const uploadRoutes = require('../src/routes/upload.routes').default;
  const reservationRoutes = require('../src/routes/reservation.routes').default;

  const TERRAIN = ['admin', 'supervisor', 'agent'];
  const GESTION = ['admin', 'supervisor'];
  const ADMIN = ['admin'];

  describe('Saisie de terrain — accessible aux agents', () => {
    const saisies: Array<[string, string]> = [
      ['post', '/:id/fuel'],
      ['post', '/:id/maintenance'],
      ['post', '/:id/technical-control'],
    ];

    it.each(saisies)('%s %s', (method, path) => {
      expect(allowedRolesFor(objectRoutes, method, path)).toEqual(TERRAIN);
    });

    it('post /file (photo depuis le terrain)', () => {
      expect(allowedRolesFor(uploadRoutes, 'post', '/file')).toEqual(TERRAIN);
    });
  });

  describe('Gestion du matériel — réservée aux superviseurs', () => {
    it('post / (créer un matériel)', () => {
      expect(allowedRolesFor(objectRoutes, 'post', '/')).toEqual(GESTION);
    });

    it('put /:id (modifier un matériel)', () => {
      expect(allowedRolesFor(objectRoutes, 'put', '/:id')).toEqual(GESTION);
    });
  });

  describe('Suppressions et référentiels — réservés aux administrateurs', () => {
    it('delete /:id (supprimer un matériel)', () => {
      expect(allowedRolesFor(objectRoutes, 'delete', '/:id')).toEqual(ADMIN);
    });

    it('post /fuel-stations (référentiel des stations)', () => {
      expect(allowedRolesFor(objectRoutes, 'post', '/fuel-stations')).toEqual(ADMIN);
    });
  });

  describe('Un agent ne doit pas pouvoir supprimer ce qu’il a saisi', () => {
    it.each([
      ['delete', '/:id/fuel/:entryId'],
      ['delete', '/:id/maintenance/:maintenanceId'],
    ] as Array<[string, string]>)('%s %s', (method, path) => {
      const roles = allowedRolesFor(objectRoutes, method, path);
      expect(roles).not.toBeNull();
      expect(roles).not.toContain('agent');
    });
  });

  describe('Réservations', () => {
    it('post / (demander une réservation) est ouvert aux agents', () => {
      expect(allowedRolesFor(reservationRoutes, 'post', '/')).toEqual(TERRAIN);
    });
  });
});
