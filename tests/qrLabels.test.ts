import fs from 'fs';
import path from 'path';

/**
 * Impression d'étiquettes QR en lot.
 *
 * `POST /api/qrcode/batch` renvoyait jusqu'à 100 étiquettes depuis toujours, et
 * n'était appelé par aucun écran : les QR codes s'imprimaient un par un depuis
 * la fiche de chaque matériel. Étiqueter un parc de cinquante machines
 * demandait cinquante allers-retours.
 *
 * Les routes n'avaient par ailleurs que `authenticateToken` : la génération en
 * lot renvoyait nom, référence et numéro de série pour des identifiants
 * arbitraires, ce qui permettait d'énumérer l'inventaire en incrémentant des
 * nombres.
 */

const RACINE = path.join(__dirname, '..');

const lire = (...m: string[]) => fs.readFileSync(path.join(RACINE, ...m), 'utf8');

const ROUTES = lire('src', 'routes', 'qrcode.routes.ts');
const COMPOSANT = lire('client', 'src', 'components', 'QrLabelsModal.tsx');
const CSS = lire('client', 'src', 'index.css');

describe('Cloisonnement par permissions', () => {
  it('les deux routes filtrent sur les catégories accessibles', () => {
    expect(ROUTES).toContain('getAccessibleCategoryIds');
    // Une seule définition du filtre, appelée par la route unitaire et par le lot.
    expect(ROUTES.match(/clauseCategoriesAccessibles\(/g) ?? []).toHaveLength(3);
  });

  it('refuse à un compte sans aucune catégorie accessible', () => {
    expect(ROUTES.match(/'aucune'/g) ?? []).not.toHaveLength(0);
    expect(ROUTES).toContain('Aucune catégorie ne vous est accessible');
  });

  it('applique le même filtre que la liste des matériels', () => {
    const objets = lire('src', 'routes', 'object.routes.ts');
    const motif = /category_id IN \([^)]*\) OR EXISTS \(SELECT 1 FROM subcategories sc WHERE sc\.id = (o\.)?subcategory_id/;
    expect(ROUTES).toMatch(motif);
    expect(objets).toMatch(motif);
  });
});

describe('Impression', () => {
  it('la grille est rendue hors de l’arbre React', () => {
    // La feuille d'impression masque tous les enfants directs de `body`. Rendue
    // dans la modale, la grille se retrouvait dans `#root` — masqué avec le
    // reste — et la page sortait blanche.
    expect(COMPOSANT).toContain('createPortal');
    expect(COMPOSANT).toContain('document.body');
  });

  it('la feuille d’impression épargne la grille', () => {
    expect(CSS).toContain('body > *:not(.zone-etiquettes)');
  });

  it('la grille reste dans le flux, pour paginer', () => {
    // En positionnement absolu, tout ce qui dépasse d'une page disparaissait.
    const bloc = CSS.slice(CSS.indexOf('.zone-etiquettes {', CSS.indexOf('@media print')));
    const regle = bloc.slice(0, bloc.indexOf('}'));
    expect(regle).not.toContain('position: absolute');
    expect(regle).toContain('align-content: start');
  });

  it('une étiquette n’est jamais coupée entre deux pages', () => {
    const bloc = CSS.slice(CSS.indexOf('.etiquette {'));
    const regle = bloc.slice(0, bloc.indexOf('}'));
    expect(regle).toContain('break-inside: avoid');
    expect(regle).toContain('page-break-inside: avoid');
  });

  it('un nom trop long ne pousse pas le QR code hors de l’étiquette', () => {
    expect(CSS).toContain('overflow-wrap: anywhere');
  });
});

describe('Découpage des lots', () => {
  it('respecte la limite de 100 imposée par le serveur', () => {
    expect(ROUTES).toContain('Maximum 100 objets par lot');
    expect(COMPOSANT).toContain('const TAILLE_LOT = 100');
  });

  it('découpe au lieu de refuser au-delà de 100', () => {
    // Étiqueter un parc entier ne doit pas obliger à recommencer par tranches
    // à la main.
    expect(COMPOSANT).toMatch(/for \(let i = 0; i < ids\.length; i \+= TAILLE_LOT\)/);
  });

  it('le découpage couvre exactement la sélection', () => {
    const decouper = (total: number, taille = 100): number[] => {
      const tailles: number[] = [];
      for (let i = 0; i < total; i += taille) tailles.push(Math.min(taille, total - i));
      return tailles;
    };

    for (const total of [0, 1, 99, 100, 101, 250]) {
      const tailles = decouper(total);
      expect(tailles.reduce((a, b) => a + b, 0)).toBe(total);
      for (const t of tailles) expect(t).toBeLessThanOrEqual(100);
    }
    expect(decouper(250)).toEqual([100, 100, 50]);
    expect(decouper(100)).toEqual([100]);
    expect(decouper(0)).toEqual([]);
  });
});

describe('Branchement dans les écrans', () => {
  it('est proposé sur les catégories et les sous-catégories', () => {
    for (const page of ['CategoryDetailPage.tsx', 'SubcategoryDetailPage.tsx']) {
      const source = lire('client', 'src', 'pages', page);
      expect(source).toContain('BoutonEtiquettesQr');
    }
  });
});
