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
  const planningsRoutes = require('../src/routes/plannings.routes').default;

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

  describe('Suppression d’un matériel — réservée aux administrateurs', () => {
    it('delete /:id (supprimer un matériel)', () => {
      expect(allowedRolesFor(objectRoutes, 'delete', '/:id')).toEqual(ADMIN);
    });
  });

  /**
   * Le référentiel du parc exigeait un administrateur, alors que le tableau
   * des droits du README attribue « Gérer le référentiel » au superviseur, et
   * que `ReferenceSelect` lui montre le bouton « Ajouter ». Il voyait donc
   * l'action et récoltait un 403 — ce qui gardait les listes vides, faute de
   * quelqu’un pour les remplir.
   */
  describe('Référentiel du parc — tenu par le superviseur', () => {
    const referentiels: Array<[string, string]> = [
      ['post', '/fuel-stations'],
      ['put', '/fuel-stations/:stationId'],
      ['delete', '/fuel-stations/:stationId'],
      ['post', '/maintenance-types'],
      ['put', '/maintenance-types/:typeId'],
      ['delete', '/maintenance-types/:typeId'],
      ['post', '/maintenance-providers'],
      ['put', '/maintenance-providers/:providerId'],
      ['delete', '/maintenance-providers/:providerId'],
      ['post', '/control-centers'],
      ['put', '/control-centers/:centerId'],
      ['delete', '/control-centers/:centerId'],
    ];

    it.each(referentiels)('%s %s', (method, path) => {
      expect(allowedRolesFor(objectRoutes, method, path)).toEqual(GESTION);
    });

    it('reste fermé à l’agent et au simple utilisateur', () => {
      for (const [method, path] of referentiels) {
        const roles = allowedRolesFor(objectRoutes, method, path)!;
        expect(roles).not.toContain('agent');
        expect(roles).not.toContain('user');
        expect(roles).not.toContain('service');
      }
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

  /**
   * Plannings et heures.
   *
   * Deux droits qu'il ne faut pas confondre. **Saisir son temps** est une
   * écriture de terrain : un agent doit toujours pouvoir déclarer ses propres
   * heures, sans quoi le module ne mesure rien. **Rattacher un agent à un
   * encadrant** appartient à l'administrateur seul : un encadrant qui pourrait
   * s'attribuer des agents élargirait lui-même ce qu'il voit, et le
   * cloisonnement ne tiendrait plus que par convention.
   */
  describe('Plannings et heures', () => {
    it.each([
      ['post', '/taches'],
      ['put', '/taches/:id'],
      ['delete', '/taches/:id'],
      ['post', '/categories'],
      ['put', '/categories/:id'],
    ] as Array<[string, string]>)('%s %s est ouvert aux agents', (method, path) => {
      expect(allowedRolesFor(planningsRoutes, method, path)).toEqual(TERRAIN);
    });

    it.each([
      ['put', '/categories/:id/actif'],
      ['delete', '/categories/:id'],
    ] as Array<[string, string]>)('%s %s reste au superviseur', (method, path) => {
      expect(allowedRolesFor(planningsRoutes, method, path)).toEqual(GESTION);
    });

    it("put /superviseurs/:agentId est réservé à l'administrateur", () => {
      expect(allowedRolesFor(planningsRoutes, 'put', '/superviseurs/:agentId')).toEqual(ADMIN);
    });

    it('la lecture des heures ne porte aucune garde de rôle : le périmètre s’en charge', () => {
      // Un compte « user » doit pouvoir consulter ses propres heures ; ce qu'il
      // voit des autres est décidé par `perimetreDe`, pas par son rôle.
      expect(allowedRolesFor(planningsRoutes, 'get', '/taches')).toBeNull();
      expect(allowedRolesFor(planningsRoutes, 'get', '/rapport')).toBeNull();
    });
  });
});
describe('Tickets', () => {
  const ticketRoutes = require('../src/routes/ticket.routes').default;
  const ticketReferentielRoutes = require('../src/routes/ticketReferentiel.routes').default;
  const siteRoutes = require('../src/routes/site.routes').default;

  const GESTION = ['admin', 'supervisor'];
  const ADMIN = ['admin'];

  describe('Les demandes ne portent aucune garde de rôle', () => {
    /*
     * C'est le point le plus important de ce fichier pour le module.
     *
     * Le demandeur d'un ticket est précisément un compte « user » ou
     * « service ». Poser `requireFieldWrite` — même par réflexe, parce que
     * c'est ce que fait `/api/upload/file` — lui interdirait d'ouvrir une
     * demande, d'y répondre et d'y joindre la photo du rideau cassé : le
     * module serait inutilisable par ceux à qui il est destiné.
     *
     * Ce qui protège ces routes est `ticketScope.ts`, et lui seul.
     */
    it.each([
      ['post', '/'],
      ['get', '/'],
      ['get', '/:id'],
      ['put', '/:id'],
      ['put', '/:id/statut'],
      ['get', '/:id/fil'],
      ['post', '/:id/messages'],
      ['post', '/:id/documents'],
      ['delete', '/:id/documents/:docId'],
      ['post', '/:id/observateurs'],
      ['get', '/formulaire'],
      ['get', '/compteurs'],
    ] as Array<[string, string]>)('%s %s est ouvert à tout compte connecté', (method, path) => {
      expect(allowedRolesFor(ticketRoutes, method, path)).toBeNull();
    });

    it('n’importe pas requireFieldWrite', () => {
      // Un test négatif : la garde exclurait `user` et `service`, qui sont les
      // deux rôles pour lesquels le module existe. On regarde l'import et non
      // le texte entier, puisque le fichier explique en commentaire pourquoi
      // cette garde est écartée — et cette explication doit pouvoir rester.
      const source = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'src', 'routes', 'ticket.routes.ts'),
        'utf8'
      );
      const imports = source.match(/import\s*\{[^}]*\}\s*from\s*'[^']*auth\.middleware'/s)?.[0] ?? '';
      expect(imports).not.toContain('requireFieldWrite');
      expect(imports).toContain('authenticateToken');
    });

    it('réserve la suppression définitive à l’administrateur', () => {
      // Supprimer une demande emporte son fil et ses pièces, sans retour.
      expect(allowedRolesFor(ticketRoutes, 'delete', '/:id')).toEqual(ADMIN);
    });
  });

  describe('Le référentiel', () => {
    it('laisse lire à tout compte connecté', () => {
      // Un formulaire a besoin du nom et de la couleur des statuts.
      expect(allowedRolesFor(ticketReferentielRoutes, 'get', '/statuts')).toBeNull();
      expect(allowedRolesFor(ticketReferentielRoutes, 'get', '/categories')).toBeNull();
    });

    it.each([
      ['post', '/statuts'],
      ['put', '/statuts/:id'],
      ['post', '/categories'],
      ['put', '/categories/:id'],
    ] as Array<[string, string]>)('%s %s est réservé à l’encadrement', (method, path) => {
      expect(allowedRolesFor(ticketReferentielRoutes, method, path)).toEqual(GESTION);
    });

    it.each([
      ['delete', '/statuts/:id'],
      ['delete', '/categories/:id'],
      ['get', '/utilisateurs/:userId'],
      ['put', '/utilisateurs/:userId'],
      // Une règle décide de qui reçoit quoi : la laisser au superviseur
      // reviendrait à le laisser s'abonner aux demandes des autres services.
      ['get', '/rattachements'],
      ['post', '/rattachements/en-masse'],
      ['get', '/regles'],
      ['post', '/regles'],
      ['put', '/regles/:id'],
      ['delete', '/regles/:id'],
      ['post', '/regles/simulation'],
    ] as Array<[string, string]>)('%s %s reste à l’administrateur', (method, path) => {
      // Les rattachements décident de ce qu'une personne voit : les ouvrir au
      // superviseur reviendrait à lui laisser s'accorder l'accès à un bâtiment.
      expect(allowedRolesFor(ticketReferentielRoutes, method, path)).toEqual(ADMIN);
    });
  });

  describe('Les sites', () => {
    it('laisse lire à tout compte connecté', () => {
      expect(allowedRolesFor(siteRoutes, 'get', '/')).toBeNull();
      expect(allowedRolesFor(siteRoutes, 'get', '/mes-sites')).toBeNull();
    });

    it.each([
      ['post', '/'],
      ['put', '/:id'],
    ] as Array<[string, string]>)('%s %s est réservé à l’encadrement', (method, path) => {
      expect(allowedRolesFor(siteRoutes, method, path)).toEqual(GESTION);
    });

    it.each([
      ['delete', '/:id'],
      ['get', '/:id/membres'],
    ] as Array<[string, string]>)('%s %s reste à l’administrateur', (method, path) => {
      expect(allowedRolesFor(siteRoutes, method, path)).toEqual(ADMIN);
    });
  });
});
