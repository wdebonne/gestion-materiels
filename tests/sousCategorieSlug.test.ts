import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * Le slug d'une sous-catégorie n'est unique **que dans sa catégorie**.
 *
 * C'est voulu : « Technique › Prestations » et « Urbanisme › Prestations »
 * doivent pouvoir coexister — c'est même l'organisation recommandée, où la
 * catégorie est le service et ses sous-catégories mêlent matériel et
 * prestations. La contrainte d'unicité posée à la création le dit déjà :
 * `WHERE category_id = ? AND slug = ?`.
 *
 * Mais une lecture par le seul slug rendait alors la **première venue**. Ouvrir
 * « Technique › Prestations » affichait le matériel d'« Urbanisme › Prestations »,
 * sans le moindre signe que quelque chose clochait : deux écrans différents, le
 * même contenu, et l'impression que les deux sous-catégories avaient fusionné.
 *
 * Le défaut ne demandait aucune erreur de saisie pour se produire — seulement
 * deux catégories nommant pareillement une de leurs branches.
 */

const RACINE = path.join(__dirname, '..');

/** Deux catégories, chacune avec sa « Prestations » et son propre matériel. */
function base(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT UNIQUE);
    CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name TEXT, slug TEXT);
    CREATE TABLE objects (id INTEGER PRIMARY KEY, name TEXT, subcategory_id INTEGER);

    INSERT INTO categories (id, name, slug) VALUES
      (1, 'Urbanisme', 'urbanisme'),
      (2, 'Technique', 'technique');

    INSERT INTO subcategories (id, category_id, name, slug) VALUES
      (31, 1, 'Prestations', 'prestations'),
      (32, 2, 'Prestations', 'prestations');

    INSERT INTO objects (id, name, subcategory_id) VALUES
      (1, 'Demande d’arrêté de boisson', 31),
      (2, 'Raccordement électrique', 32);
  `);
  return db;
}

describe('Deux catégories peuvent nommer pareillement une sous-catégorie', () => {
  it('la contrainte d’unicité ne porte que sur la catégorie', () => {
    const db = base();
    // Rien n'empêche le doublon de slug entre deux catégories : c'est le cas
    // que l'application doit savoir servir, pas un état à interdire.
    const doublons = db
      .prepare("SELECT COUNT(*) as n FROM subcategories WHERE slug = 'prestations'")
      .get() as { n: number };
    expect(doublons.n).toBe(2);
    db.close();
  });

  it('chercher par le seul slug est ambigu — c’était le défaut', () => {
    const db = base();
    const trouvees = db
      .prepare(
        `SELECT s.id FROM subcategories s
         JOIN categories c ON c.id = s.category_id
         WHERE s.slug = ?`
      )
      .all('prestations');

    // Deux réponses possibles : prendre la première, c'est se tromper une fois
    // sur deux, en silence.
    expect(trouvees).toHaveLength(2);
    db.close();
  });

  it('cadrer par la catégorie rend la bonne, et elle seule', () => {
    const db = base();
    const cadree = (categorie: string) =>
      db
        .prepare(
          `SELECT s.id FROM subcategories s
           JOIN categories c ON c.id = s.category_id
           WHERE s.slug = ? AND c.slug = ?`
        )
        .all('prestations', categorie);

    expect(cadree('urbanisme')).toEqual([{ id: 31 }]);
    expect(cadree('technique')).toEqual([{ id: 32 }]);
    db.close();
  });

  it('chaque sous-catégorie garde son propre matériel', () => {
    const db = base();
    const materiels = (categorie: string) =>
      db
        .prepare(
          `SELECT o.name FROM objects o
           JOIN subcategories s ON s.id = o.subcategory_id
           JOIN categories c ON c.id = s.category_id
           WHERE s.slug = 'prestations' AND c.slug = ?`
        )
        .all(categorie)
        .map((l: any) => l.name);

    expect(materiels('urbanisme')).toEqual(['Demande d’arrêté de boisson']);
    expect(materiels('technique')).toEqual(['Raccordement électrique']);
    db.close();
  });
});

describe('Les lectures sont cadrées', () => {
  const ROUTES = fs.readFileSync(path.join(RACINE, 'src', 'routes', 'category.routes.ts'), 'utf8');
  const ECRAN = fs.readFileSync(
    path.join(RACINE, 'client', 'src', 'pages', 'SubcategoryDetailPage.tsx'),
    'utf8'
  );

  it('la route par slugs filtre bien sur la catégorie', () => {
    expect(ROUTES).toContain('FROM subcategories WHERE category_id = ? AND slug = ?');
  });

  it('`by-slug` refuse de trancher au hasard', () => {
    // Une erreur explicite vaut mieux qu'une réponse fausse qu'on croira juste.
    const debut = ROUTES.indexOf("subcategoryRouter.get('/by-slug/:slug'");
    const corps = ROUTES.slice(debut, debut + 2000);
    expect(corps).toContain('candidates.length > 1');
    expect(corps).toContain('req.query.category');
  });

  it('l’écran d’une sous-catégorie passe par la route cadrée', () => {
    // Le piège reviendrait au premier appel qui oublie la catégorie.
    expect(ECRAN).not.toMatch(/subcategories\/by-slug\//);
    expect(ECRAN).toContain('`/categories/${categorySlug}/${subcategorySlug}`');
  });

  it('sa clé de cache porte les deux slugs', () => {
    // Sans le slug de la catégorie, les deux écrans partageraient une entrée de
    // cache et se serviraient mutuellement leur contenu.
    expect(ECRAN).toContain("queryKey: ['subcategory', categorySlug, subcategorySlug]");
  });
});
