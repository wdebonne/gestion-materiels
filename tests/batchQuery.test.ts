/**
 * Chargement groupé des lignes liées.
 *
 * Le motif remplacé émettait une requête par parent : la fiche d'un espace vert
 * de 50 entretiens déclenchait une centaine d'allers-retours. Ces tests figent
 * les deux propriétés qui rendent le remplacement sûr : le regroupement doit
 * rendre exactement ce que rendait la boucle, et la liste d'identifiants doit
 * être découpée pour ne jamais dépasser la limite de paramètres liés de SQLite.
 */

const requetes: Array<{ sql: string; params: any[] }> = [];
let reponse: (sql: string, params: any[]) => any[] = () => [];

jest.mock('../src/database', () => ({
  db: {
    query: jest.fn(async (sql: string, params: any[]) => {
      requetes.push({ sql, params });
      return reponse(sql, params);
    }),
  },
}));

import { grouperEnfants, enfantsDe } from '../src/utils/batchQuery';

beforeEach(() => {
  requetes.length = 0;
  reponse = () => [];
});

const sqlAvecMarqueurs = (marqueurs: string) =>
  `SELECT maintenance_id, element_id FROM green_space_maintenance_elements WHERE maintenance_id IN (${marqueurs})`;

describe('grouperEnfants', () => {
  it('ne fait qu’une requête pour plusieurs parents', async () => {
    reponse = () => [
      { maintenance_id: 1, element_id: 10 },
      { maintenance_id: 1, element_id: 11 },
      { maintenance_id: 3, element_id: 12 },
    ];

    const parEntretien = await grouperEnfants(sqlAvecMarqueurs, [1, 2, 3], 'maintenance_id');

    expect(requetes).toHaveLength(1);
    expect(requetes[0].params).toEqual([1, 2, 3]);
    expect(requetes[0].sql).toContain('IN (?, ?, ?)');
    expect(enfantsDe(parEntretien, 1).map((r: any) => r.element_id)).toEqual([10, 11]);
    expect(enfantsDe(parEntretien, 3).map((r: any) => r.element_id)).toEqual([12]);
  });

  it('rend une liste vide pour un parent sans ligne liée', async () => {
    // La boucle remplacée renvoyait [] : un entretien sans élément reste valide.
    const parEntretien = await grouperEnfants(sqlAvecMarqueurs, [7], 'maintenance_id');
    expect(enfantsDe(parEntretien, 7)).toEqual([]);
  });

  it('ne requête pas du tout sans parent', async () => {
    // Sinon on produirait « IN () », rejeté par SQLite.
    const vide = await grouperEnfants(sqlAvecMarqueurs, [], 'maintenance_id');
    expect(requetes).toHaveLength(0);
    expect(vide.size).toBe(0);
  });

  it('dédoublonne les identifiants', async () => {
    await grouperEnfants(sqlAvecMarqueurs, [4, 4, 5], 'maintenance_id');
    expect(requetes[0].params).toEqual([4, 5]);
  });

  it('découpe en tranches sous la limite de paramètres liés', async () => {
    const ids = Array.from({ length: 950 }, (_, i) => i + 1);
    reponse = (_sql, params) => params.map((id) => ({ maintenance_id: id, element_id: id * 10 }));

    const parEntretien = await grouperEnfants(sqlAvecMarqueurs, ids, 'maintenance_id');

    expect(requetes).toHaveLength(3);
    for (const r of requetes) expect(r.params.length).toBeLessThanOrEqual(400);
    expect(requetes.reduce((n, r) => n + r.params.length, 0)).toBe(950);
    // Le découpage ne doit rien perdre ni rien mélanger.
    expect(parEntretien.size).toBe(950);
    expect(enfantsDe(parEntretien, 950)[0]).toEqual({ maintenance_id: 950, element_id: 9500 });
  });

  it('accepte des paramètres supplémentaires après les identifiants', async () => {
    // Cas de la disponibilité du stock, filtrée sur une date.
    await grouperEnfants(
      (marqueurs) => `SELECT stock_id FROM mm WHERE stock_id IN (${marqueurs}) AND d <= ?`,
      [8, 9],
      'stock_id',
      (tranche) => [...tranche, '2026-09-20']
    );
    expect(requetes[0].params).toEqual([8, 9, '2026-09-20']);
  });
});
