import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * Portée des matériels : quelles routes peuvent en rendre lesquels.
 *
 * `GET /objects` filtrait par catégories accessibles depuis longtemps, mais la
 * règle était réécrite à la main partout où elle servait — et oubliée partout
 * ailleurs. Une revue des treize fichiers touchant la table a trouvé quatre
 * endpoints qui rendaient des matériels qu'un compte n'a pas le droit de
 * consulter :
 *
 *   GET /objects/:id                  la liste filtrait, le détail non
 *   GET /green-spaces/search/objects  recherche libre sur tout le parc,
 *                                     prix d'achat compris
 *   GET /reservations                 noms et références via les réservations
 *   GET /calendar/events              noms via les événements
 *
 * Toutes étaient authentifiées : c'est le contrôle *après* l'authentification
 * qui manquait — le même angle mort que pour les tokens API, l'export et la
 * génération de QR codes.
 *
 * Le test qui compte ici est le dernier : il échoue dès qu'un fichier lit
 * `objects` sans appliquer la portée ni figurer dans les exemptions motivées.
 * Sans lui, la prochaine route rouvrira le trou.
 */

const RACINE = path.join(__dirname, '..');

/**
 * Fichiers qui lisent `objects` sans appliquer la portée, et pourquoi c'est
 * volontaire. Ajouter une entrée ici est une décision, pas un contournement.
 */
const EXEMPTIONS: Record<string, string> = {
  'routes/category.routes.ts':
    "Ne compte que des matériels par catégorie, et uniquement pour les catégories déjà filtrées par la requête appelante : la portée est acquise par construction.",
  'routes/customFields.routes.ts':
    "Lit la catégorie d'un matériel pour rendre la configuration de ses champs, jamais ses données. Révèle au plus l'existence d'un identifiant.",
  'routes/espaceVert.routes.ts':
    "Les jointures restantes ne concernent que des matériels explicitement rattachés à un élément d'espace vert par un superviseur : l'accès y est gouverné par l'espace vert, pas par la catégorie du matériel. La recherche libre, elle, applique la portée.",
  'services/cron.service.ts':
    "Tâche planifiée, sans requête ni utilisateur : il n'y a pas de portée à appliquer.",
  'services/email.service.ts':
    "Composition d'e-mails côté serveur, sans requête ni utilisateur.",
  'services/manifestationDocuments.service.ts':
    "La jointure ne sert qu'à afficher le nom du matériel qu'une pièce jointe désigne, sur une manifestation que l'appelant a déjà le droit de voir (peutVoirManifestation en amont de chaque route). Filtrer ici masquerait le document entier au lieu de son libellé, et le rattachement a été contrôlé au moment où il a été posé.",
  'services/coutManifestation.service.ts':
    "Ne lit que les matériels déjà rattachés à une manifestation, pour en chiffrer le coût, et n'est appelé que par des routes qui ont déjà vérifié que l'appelant voit cette manifestation. Ne rend que des montants et des libellés, jamais une fiche de matériel.",
  'services/lotParc.service.ts':
    "Arithmétique de stock sur des matériels déjà rattachés à une manifestation, ou dont l'appelant a obtenu les identifiants par une lecture qui, elle, applique la portée (parcAvecDisponibilite, objetsDe). Ne rend que des quantités et le nom d'un lot en rupture, jamais une fiche de matériel ni un prix d'achat.",
  'services/manifestationServices.service.ts':
    "Ne rend jamais de données de matériel : la jointure sert à savoir quels services ont ces matériels dans leur périmètre, et les identifiants viennent d'une manifestation que l'appelant voit déjà. Filtrer par les catégories du lecteur reviendrait à ne pas solliciter un service parce que celui qui a saisi la demande n'a pas accès à sa catégorie.",
  'services/donneesModele.service.ts':
    "Ne lit que les prestations déjà rattachées à une manifestation donnée, pour remplir le document destiné à un service — et les filtre par le périmètre de ce service, ce qui est une portée plus étroite que celle des catégories. Aucun appelant n'est piloté par un utilisateur qui naviguerait dans le parc : la génération tourne côté serveur sans requête, et l'aperçu est réservé à l'administrateur.",
};

/** Marques d'une portée appliquée. */
const MARQUES_PORTEE = ['filtreObjets', 'filtreObjetsLies', 'peutVoirObjet', 'getAccessibleCategoryIds'];

function fichiersTypeScript(dossier: string, trouves: string[] = []): string[] {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) fichiersTypeScript(chemin, trouves);
    else if (entree.name.endsWith('.ts')) trouves.push(chemin);
  }
  return trouves;
}

/** Fichiers qui lisent la table `objects`. */
function lecteursDObjets(): Array<{ cle: string; source: string }> {
  return fichiersTypeScript(path.join(RACINE, 'src'))
    .map((chemin) => ({
      cle: path.relative(path.join(RACINE, 'src'), chemin).split(path.sep).join('/'),
      source: fs.readFileSync(chemin, 'utf8'),
    }))
    .filter(({ source }) => /FROM objects\b|JOIN objects\b/.test(source));
}

describe('Portée appliquée', () => {
  it('couvre tous les fichiers qui lisent `objects`', () => {
    const sansPortee = lecteursDObjets()
      .filter(({ cle, source }) => !EXEMPTIONS[cle] && !MARQUES_PORTEE.some((m) => source.includes(m)))
      .map(({ cle }) => cle);

    // Un nouveau fichier lisant `objects` doit soit appliquer la portée, soit
    // être exempté avec sa raison.
    expect(sansPortee).toEqual([]);
  });

  it('n’exempte que des fichiers qui existent encore', () => {
    // Une exemption qui survit à son fichier masquerait une régression.
    const cles = lecteursDObjets().map(({ cle }) => cle);
    for (const exempte of Object.keys(EXEMPTIONS)) {
      expect(cles).toContain(exempte);
    }
  });

  it('motive chaque exemption', () => {
    for (const [cle, raison] of Object.entries(EXEMPTIONS)) {
      expect(raison.length).toBeGreaterThan(60);
      expect(cle).toMatch(/\.ts$/);
    }
  });

  it('couvre les quatre endpoints qui fuyaient', () => {
    const lire = (...m: string[]) => fs.readFileSync(path.join(RACINE, 'src', ...m), 'utf8');
    for (const fichier of [
      ['routes', 'object.routes.ts'],
      ['routes', 'espaceVert.routes.ts'],
      ['routes', 'reservation.routes.ts'],
      ['routes', 'calendar.routes.ts'],
    ]) {
      expect(lire(...fichier)).toMatch(/filtreObjets(Lies)?\(/);
    }
  });
});

describe('Construction du filtre', () => {
  /** Reproduit la clause du service, contre une vraie base. */
  const CLAUSE = (alias: string, marqueurs: string) =>
    `${alias}.category_id IN (${marqueurs}) OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = ${alias}.subcategory_id AND sc.category_id IN (${marqueurs}))`;

  function base(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER, name TEXT);
      CREATE TABLE objects (id INTEGER PRIMARY KEY, name TEXT, category_id INTEGER, subcategory_id INTEGER);
      INSERT INTO categories (id, name) VALUES (1, 'Autorisée'), (2, 'Interdite');
      INSERT INTO subcategories (id, category_id, name) VALUES (10, 1, 'Sous autorisée'), (20, 2, 'Sous interdite');
      INSERT INTO objects (id, name, category_id, subcategory_id) VALUES
        (1, 'Direct autorisé', 1, NULL),
        (2, 'Direct interdit', 2, NULL),
        (3, 'Par sous-catégorie autorisée', NULL, 10),
        (4, 'Par sous-catégorie interdite', NULL, 20);
    `);
    return db;
  }

  it('retient un matériel par sa catégorie directe comme par sa sous-catégorie', () => {
    // Les deux colonnes coexistent et l'une peut être nulle : filtrer sur la
    // seule `category_id` masquerait la moitié du parc à son propre gestionnaire.
    const db = base();
    const noms = db
      .prepare(`SELECT name FROM objects o WHERE ${CLAUSE('o', '?')} ORDER BY id`)
      .all(1, 1)
      .map((l: any) => l.name);

    expect(noms).toEqual(['Direct autorisé', 'Par sous-catégorie autorisée']);
    db.close();
  });

  it('écarte ce qui relève d’une catégorie non accessible', () => {
    const db = base();
    const noms = db
      .prepare(`SELECT name FROM objects o WHERE ${CLAUSE('o', '?')}`)
      .all(1, 1)
      .map((l: any) => l.name);

    expect(noms).not.toContain('Direct interdit');
    expect(noms).not.toContain('Par sous-catégorie interdite');
    db.close();
  });
});

describe('Lignes rattachées à un matériel', () => {
  it('laisse passer celles qui n’en portent aucun', () => {
    // La plupart des événements de calendrier n'ont pas de matériel : les
    // faire disparaître serait une régression, pas une protection.
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE subcategories (id INTEGER PRIMARY KEY, category_id INTEGER);
      CREATE TABLE objects (id INTEGER PRIMARY KEY, category_id INTEGER, subcategory_id INTEGER);
      CREATE TABLE calendar_events (id INTEGER PRIMARY KEY, title TEXT, object_id INTEGER);
      INSERT INTO objects (id, category_id) VALUES (1, 1), (2, 2);
      INSERT INTO calendar_events (id, title, object_id) VALUES
        (1, 'Entretien autorisé', 1),
        (2, 'Entretien interdit', 2),
        (3, 'Réunion de service', NULL);
    `);

    const titres = db
      .prepare(`
        SELECT ce.title FROM calendar_events ce
        LEFT JOIN objects o ON o.id = ce.object_id
        WHERE (ce.object_id IS NULL OR (o.category_id IN (?) OR EXISTS (SELECT 1 FROM subcategories sc WHERE sc.id = o.subcategory_id AND sc.category_id IN (?))))
        ORDER BY ce.id
      `)
      .all(1, 1)
      .map((l: any) => l.title);

    expect(titres).toEqual(['Entretien autorisé', 'Réunion de service']);
    db.close();
  });
});
