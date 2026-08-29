import type { Request, Response, NextFunction } from 'express';

/**
 * Contrat de validation des saisies de terrain.
 *
 * Une charge incomplète produisait un 500 « Erreur serveur » : la contrainte
 * NOT NULL de SQLite remontait jusqu'au gestionnaire générique. L'agent n'avait
 * aucun moyen de savoir ce qui manquait.
 *
 * Ces tests figent deux choses :
 *   - ce qui est obligatoire, et le message rendu ;
 *   - que les noms de champs validés sont bien ceux que la route lit. C'est
 *     l'erreur que j'ai commise en écrivant cette validation : valider `date`
 *     alors que la route lit `controlDate` rejetait toutes les saisies
 *     légitimes.
 */

const objectRoutes = require('../src/routes/object.routes').default;

/** Chaînes de validation express-validator déclarées sur une route. */
function validateursDe(method: string, path: string): any[] {
  const layer = objectRoutes.stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method.toLowerCase()]
  );
  if (!layer) return [];

  // express-validator expose les champs sous `builder.fields`.
  return layer.route.stack
    .map((s: any) => s.handle)
    .filter((h: any) => Array.isArray(h?.builder?.fields));
}

/** Champs couverts par la validation d'une route. */
function champsValides(method: string, path: string): string[] {
  const champs = new Set<string>();
  for (const v of validateursDe(method, path)) {
    for (const f of v.builder.fields as string[]) champs.add(f);
  }
  return [...champs];
}

/** Exécute les validateurs d'une route sur un corps de requête donné. */
async function valider(method: string, path: string, body: any) {
  const { validationResult } = require('express-validator');
  const req = { body, params: {}, query: {}, headers: {}, cookies: {} } as unknown as Request;
  const res = {} as Response;

  for (const v of validateursDe(method, path)) {
    await new Promise<void>((resolve) => v(req, res, (() => resolve()) as NextFunction));
  }

  const resultat = validationResult(req);
  return {
    valide: resultat.isEmpty(),
    messages: resultat.array().map((e: any) => e.msg),
  };
}

const AUJOURDHUI = '2026-08-28';

describe('Champs validés vs champs lus par la route', () => {
  // Le décalage est invisible à la relecture et rejette toutes les saisies.
  it('le plein valide `quantity`, que la route lit', () => {
    expect(champsValides('post', '/:id/fuel')).toContain('quantity');
  });

  it("l'entretien valide `maintenanceType` et `maintenanceDate`", () => {
    const champs = champsValides('post', '/:id/maintenance');
    expect(champs).toContain('maintenanceType');
    expect(champs).toContain('maintenanceDate');
  });

  it('le contrôle valide `controlDate`, et non `date`', () => {
    const champs = champsValides('post', '/:id/technical-control');
    expect(champs).toContain('controlDate');
    expect(champs).not.toContain('date');
  });
});

describe('Relevé de plein', () => {
  it('refuse une saisie sans quantité', async () => {
    const r = await valider('post', '/:id/fuel', { date: AUJOURDHUI });
    expect(r.valide).toBe(false);
    expect(r.messages[0]).toMatch(/quantité est obligatoire/i);
  });

  it('refuse une quantité négative ou nulle', async () => {
    for (const quantity of [-5, 0]) {
      const r = await valider('post', '/:id/fuel', { quantity, date: AUJOURDHUI });
      expect(r.valide).toBe(false);
    }
  });

  it('refuse un coût non numérique', async () => {
    const r = await valider('post', '/:id/fuel', { quantity: 40, cost: 'douze' });
    expect(r.valide).toBe(false);
    expect(r.messages.join(' ')).toMatch(/coût/i);
  });

  it('accepte la charge réelle envoyée par le client', async () => {
    const r = await valider('post', '/:id/fuel', {
      date: AUJOURDHUI,
      quantity: '42',
      cost: '68.50',
      mileage: '12500',
      station: 'Total Pavilly',
    });
    expect(r.valide).toBe(true);
  });

  it('accepte un coût et un kilométrage laissés vides', async () => {
    const r = await valider('post', '/:id/fuel', { quantity: '40', cost: '', mileage: '' });
    expect(r.valide).toBe(true);
  });
});

describe('Relevé d’entretien', () => {
  it('refuse une saisie sans type', async () => {
    const r = await valider('post', '/:id/maintenance', { maintenanceDate: AUJOURDHUI });
    expect(r.valide).toBe(false);
    expect(r.messages[0]).toMatch(/type d'entretien/i);
  });

  it('refuse une saisie sans date', async () => {
    const r = await valider('post', '/:id/maintenance', { maintenanceType: 'Vidange' });
    expect(r.valide).toBe(false);
    expect(r.messages[0]).toMatch(/date/i);
  });

  it('accepte une saisie complète', async () => {
    const r = await valider('post', '/:id/maintenance', {
      maintenanceType: 'Vidange',
      maintenanceDate: AUJOURDHUI,
      cost: '120',
      mileage: '12500',
    });
    expect(r.valide).toBe(true);
  });
});

describe('Relevé de contrôle technique', () => {
  it('refuse une saisie sans date de contrôle', async () => {
    const r = await valider('post', '/:id/technical-control', { expiryDate: '2028-01-01' });
    expect(r.valide).toBe(false);
    expect(r.messages[0]).toMatch(/date du contrôle/i);
  });

  it("refuse une saisie sans date d'expiration", async () => {
    const r = await valider('post', '/:id/technical-control', { controlDate: AUJOURDHUI });
    expect(r.valide).toBe(false);
  });

  it('accepte la charge réelle envoyée par le client', async () => {
    const r = await valider('post', '/:id/technical-control', {
      controlDate: AUJOURDHUI,
      expiryDate: '2028-08-28',
      result: 'passed',
      mileage: 12500,
      cost: 89,
    });
    expect(r.valide).toBe(true);
  });
});
