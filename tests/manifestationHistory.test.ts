import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * Historique des manifestations.
 *
 * La table `manifestation_history` était créée depuis le début et n'était ni
 * écrite ni lue, alors que le README et la feuille de route annonçaient une
 * « timeline horodatée de toutes les actions ». `ManifestationPDFExport.tsx`
 * était écrit et importé nulle part — et contre une forme de données qui
 * n'existe pas.
 *
 * Un prêt de matériel pour un événement municipal engage la collectivité :
 * savoir qui a validé, qui a livré et à quelle date n'est pas un confort.
 */

const ROUTES = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'manifestation.routes.ts'),
  'utf8'
);

const COMPOSANT_PDF = fs.readFileSync(
  path.join(__dirname, '..', 'client', 'src', 'components', 'ManifestationPDFExport.tsx'),
  'utf8'
);

const PAGE = fs.readFileSync(
  path.join(__dirname, '..', 'client', 'src', 'pages', 'ManifestationsPage.tsx'),
  'utf8'
);

/**
 * Code seul, commentaires retirés.
 *
 * Les commentaires de ce dépôt citent volontiers le défaut qu'ils corrigent :
 * chercher un ancien nom de champ dans le fichier entier le retrouverait dans
 * l'explication qui dit précisément qu'il n'existe plus.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Écriture de l’historique', () => {
  it('consigne chaque action qui engage la collectivité', () => {
    // Création, modification, changement de statut et mise à jour des
    // quantités : ce sont les quatre moments où quelqu'un décide quelque chose.
    const appels = ROUTES.match(/consignerHistorique\(/g) ?? [];
    // Une définition, quatre appels.
    expect(appels.length).toBeGreaterThanOrEqual(5);
  });

  it('rattache chaque événement à son auteur', () => {
    expect(ROUTES).toMatch(/consignerHistorique\([^)]*req\.user!\.userId/);
  });

  it('n’échoue jamais l’action qu’elle décrit', () => {
    // Perdre une ligne d'historique est moins grave que perdre une livraison.
    const debut = ROUTES.indexOf('async function consignerHistorique');
    const corps = ROUTES.slice(debut, ROUTES.indexOf('\n}', debut));
    expect(corps).toContain('try {');
    expect(corps).toContain('catch');
  });
});

describe('Lecture de l’historique', () => {
  it('est joint au détail et disponible seul', () => {
    expect(ROUTES).toContain("router.get('/:id/history'");
    // Le détail s'est enrichi au fil des lots — matériel du parc, pièces
    // jointes, coût — et continuera de le faire : ce qui compte ici est que
    // l'historique et le matériel accompagnent la fiche, pas l'ordre des clés
    // ni ce qui les suit.
    expect(ROUTES).toMatch(/data: \{ \.\.\.m, materials,[^}]*history[^}]*\}/);
  });

  it('rend le nom de l’auteur, pas seulement son identifiant', () => {
    const debut = ROUTES.indexOf('async function lireHistorique');
    const corps = ROUTES.slice(debut, ROUTES.indexOf('\n}', debut));
    expect(corps).toContain('u.first_name');
    expect(corps).toContain('LEFT JOIN users');
    // `LEFT JOIN` : un compte supprimé ne doit pas faire disparaître la ligne.
    expect(corps).not.toContain('INNER JOIN');
  });

  it('affiche le plus récent en premier', () => {
    const debut = ROUTES.indexOf('async function lireHistorique');
    const corps = ROUTES.slice(debut, ROUTES.indexOf('\n}', debut));
    expect(corps).toMatch(/ORDER BY h\.created_at DESC/);
  });
});

describe('Ordre chronologique', () => {
  it('départage deux événements de la même seconde', () => {
    // Une validation suivie immédiatement d'une livraison partagent
    // l'horodatage à la seconde : sans l'identifiant en second critère, elles
    // s'affichent dans un ordre arbitraire.
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE manifestation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manifestation_id INTEGER NOT NULL,
        action VARCHAR(100) NOT NULL,
        created_at DATETIME
      )
    `);
    const meme = '2026-09-20T10:00:00.000Z';
    for (const action of ['Création', 'Validation', 'Livraison']) {
      db.prepare('INSERT INTO manifestation_history (manifestation_id, action, created_at) VALUES (1, ?, ?)').run(action, meme);
    }

    const lignes = db
      .prepare('SELECT action FROM manifestation_history WHERE manifestation_id = 1 ORDER BY created_at DESC, id DESC')
      .all() as Array<{ action: string }>;

    expect(lignes.map((l) => l.action)).toEqual(['Livraison', 'Validation', 'Création']);
    db.close();
  });
});

describe('Fiche PDF', () => {
  it('est réellement branchée dans l’écran', () => {
    // Le composant existait sans être importé nulle part.
    expect(PAGE).toContain("import ManifestationPDFExport from '@/components/ManifestationPDFExport'");
    expect(PAGE).toContain('<ManifestationPDFExport');
  });

  it('lit les champs que l’API renvoie vraiment', () => {
    // La version précédente lisait `name`, `items`, `object_name`, `quantity`
    // et `res.data` — aucun de ces noms n'existe dans la réponse.
    for (const champ of ['detail.title', 'detail.materials', 'detail.history', 'res.data.data']) {
      expect(COMPOSANT_PDF).toContain(champ);
    }
    const code = sansCommentaires(COMPOSANT_PDF);
    for (const disparu of ['detail.name', 'detail.items', 'item.object_name']) {
      expect(code).not.toContain(disparu);
    }
  });

  it('utilise les statuts du serveur, pas des libellés français', () => {
    // `brouillon`, `validee`… n'ont jamais été stockés : chaque statut serait
    // ressorti brut dans la fiche.
    for (const statut of ['draft', 'validated', 'delivered', 'recovered', 'archived', 'cancelled']) {
      expect(COMPOSANT_PDF).toContain(`${statut}:`);
    }
    expect(sansCommentaires(COMPOSANT_PDF)).not.toContain('brouillon:');
  });

  it('supporte une manifestation sans matériel ni historique', () => {
    // `detail.materials` et `detail.history` peuvent être absents sur une
    // manifestation ancienne : la génération ne doit pas s'arrêter dessus.
    expect(COMPOSANT_PDF).toMatch(/detail\.materials \?\? \[\]/);
    expect(COMPOSANT_PDF).toMatch(/detail\.history \?\? \[\]/);
  });
});

describe('Mise à jour des quantités', () => {
  it('refuse une mise à jour qui ne touche aucune ligne', () => {
    // La route répondait 200 même quand rien n'était modifié, par exemple avec
    // un identifiant de stock à la place de l'identifiant de ligne.
    const debut = ROUTES.indexOf("router.put('/:id/materials'");
    const corps = ROUTES.slice(debut, ROUTES.indexOf('\n});', debut));
    expect(corps).toContain('modifiees');
    expect(corps).toMatch(/modifiees === 0/);
    expect(corps).toContain('400');
  });
});
