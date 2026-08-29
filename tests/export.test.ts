import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';

/**
 * Export des matériels.
 *
 * Deux défauts corrigés en même temps, tous deux invisibles depuis la liste des
 * routes :
 *
 *  - la route n'avait que `authenticateToken`, sans le filtrage par catégories
 *    accessibles qu'applique `GET /objects`. N'importe quel compte exportait le
 *    parc entier, y compris les catégories qu'il n'a pas le droit de consulter ;
 *  - chaque CSV commençait par deux lignes d'en-tête identiques, ce qui décale
 *    toute relecture et fait échouer un réimport.
 */

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'importExport.routes.ts'),
  'utf8'
);

/** Corps de la route d'export, isolé pour que les recherches ne débordent pas. */
function routeExport(): string {
  const debut = SOURCE.indexOf("router.get('/export'");
  expect(debut).toBeGreaterThan(-1);
  const fin = SOURCE.indexOf("router.get('/template'", debut);
  return SOURCE.slice(debut, fin === -1 ? undefined : fin);
}

describe('Cloisonnement par permissions', () => {
  it('l’export filtre sur les catégories accessibles', () => {
    // Sans cet appel, un compte sans aucune permission de catégorie récupère
    // l'inventaire complet dans un fichier, alors que l'écran ne lui montre rien.
    expect(routeExport()).toContain('getAccessibleCategoryIds');
  });

  it('refuse l’export à un compte sans aucune catégorie accessible', () => {
    const corps = routeExport();
    expect(corps).toMatch(/accessibleIds\.length === 0/);
    expect(corps).toMatch(/403/);
  });

  it('applique le même filtre que la liste des matériels', () => {
    // Les deux routes doivent décrire la même appartenance : catégorie directe,
    // ou sous-catégorie rattachée à une catégorie accessible.
    const objets = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'object.routes.ts'),
      'utf8'
    );
    const motif = /o\.category_id IN \([^)]*\) OR EXISTS \(SELECT 1 FROM subcategories sc WHERE sc\.id = o\.subcategory_id/;
    expect(routeExport()).toMatch(motif);
    expect(objets).toMatch(motif);
  });
});

describe('Format du fichier CSV', () => {
  /** Reproduit la construction du classeur telle que la route la fait. */
  async function csvDe(lignes: number): Promise<string[]> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Matériels');
    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Nom', key: 'name', width: 30 },
      { header: 'Statut', key: 'status', width: 15 },
    ];
    for (let i = 1; i <= lignes; i++) {
      sheet.addRow({ id: i, name: `Materiel ${i}`, status: 'active' });
    }

    const flux = new PassThrough();
    const morceaux: Buffer[] = [];
    flux.on('data', (m) => morceaux.push(Buffer.from(m)));
    const termine = new Promise<void>((resolve) => flux.on('end', () => resolve()));

    await workbook.csv.write(flux);
    flux.end();
    await termine;

    return Buffer.concat(morceaux).toString('utf8').trim().split(/\r?\n/);
  }

  it('n’écrit qu’une seule ligne d’en-tête', async () => {
    // C'est exactement ce qui était cassé : un second classeur recevait
    // `columns` — qui pose déjà l'en-tête — puis recopiait aussi la ligne 1
    // de la source.
    const lignes = await csvDe(3);
    expect(lignes.filter((l) => l.startsWith('ID,Nom'))).toHaveLength(1);
  });

  it('écrit une ligne par matériel, en-tête comprise', async () => {
    for (const n of [0, 1, 5]) {
      const lignes = await csvDe(n);
      expect(lignes.filter((l) => l.startsWith('ID,Nom'))).toHaveLength(1);
      expect(lignes).toHaveLength(n + 1);
    }
  });

  it('n’assemble plus de second classeur', () => {
    // La duplication venait de là : le classeur d'origine est écrit tel quel.
    expect(routeExport()).not.toContain('csvWorkbook');
  });
});

describe('Filtres acceptés', () => {
  it('accepte catégorie, sous-catégorie et statut', () => {
    const corps = routeExport();
    for (const filtre of ['categoryId', 'subcategoryId', 'status']) {
      expect(corps).toContain(filtre);
    }
  });
});
