import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * Les six fonctions manquantes relevées par l'audit du 13 septembre 2026.
 *
 * Ce ne sont pas des défauts de code mais des absences : rien ne se comportait
 * mal, il manquait simplement de quoi faire. Elles se vérifient donc moins par
 * un « avant/après » que par la présence d'un mécanisme et la justesse de sa
 * règle.
 */

const lire = (...bouts: string[]): string => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', ...bouts), 'utf8');
  } catch {
    return '';
  }
};

/**
 * 1 — Aucune transaction dans la couche base.
 *
 * La restauration par JSON vide chaque table puis réinsère ligne à ligne. Une
 * coupure au milieu laissait la base à moitié vide, sans retour arrière — et
 * c'est la restauration, donc le dernier recours, qui échouait ainsi.
 */
describe('1 — la couche base sait annuler', () => {
  const base = lire('src', 'database', 'index.ts');
  const backup = lire('src', 'routes', 'backup.routes.ts');

  it('expose une transaction', () => {
    expect(base).toMatch(/public async transaction<T>\(travail: \(\) => Promise<T>\)/);
    expect(base).toMatch(/BEGIN IMMEDIATE/);
    expect(base).toMatch(/ROLLBACK/);
    expect(base).toMatch(/beginTransaction\(\)/);
  });

  it('achemine les requêtes MySQL vers la connexion de la transaction', () => {
    // Sans cela, la requête repartirait sur une autre connexion du pool, donc
    // hors du BEGIN, et ne serait pas annulée.
    expect(base).toMatch(/transactionEnCours\.getStore\(\)\?\.connexion \?\? this\.mysqlPool!/);
  });

  it('sérialise les transactions entre elles', () => {
    // Sur SQLite il n'y a qu'une connexion : deux transactions qui se
    // chevaucheraient se mêleraient l'une à l'autre.
    expect(base).toMatch(/fileTransactions/);
  });

  it('fait rejoindre une transaction imbriquée à celle qui l’entoure', () => {
    expect(base).toMatch(/if \(dejaDedans\) return travail\(\);/);
  });

  it('protège la restauration par JSON', () => {
    expect(backup).toMatch(/await db\.transaction\(async \(\) => \{/);
    const debut = backup.indexOf('await db.transaction');
    const bloc = backup.slice(debut, debut + 900);
    expect(bloc).toMatch(/DELETE FROM \$\{table\}/);
    expect(bloc).toMatch(/INSERT INTO \$\{table\}/);
  });
});

/**
 * La transaction est éprouvée pour de vrai, sur une base SQLite jetable :
 * c'est la seule façon de savoir qu'un `ROLLBACK` annule bien ce qui précède.
 */
describe('1 — une transaction annule vraiment', () => {
  const fichier = path.join(__dirname, 'tmp-transaction.sqlite');
  let base: Database.Database;

  beforeEach(() => {
    fs.rmSync(fichier, { force: true });
    base = new Database(fichier);
    base.exec('CREATE TABLE materiels (id INTEGER PRIMARY KEY, nom TEXT NOT NULL)');
    base.exec("INSERT INTO materiels (nom) VALUES ('Tracteur'), ('Tondeuse')");
  });

  afterEach(() => {
    base.close();
    fs.rmSync(fichier, { force: true });
  });

  const compter = () => (base.prepare('SELECT COUNT(*) c FROM materiels').get() as any).c;

  it('laisse la table intacte quand l’insertion échoue à mi-chemin', () => {
    expect(compter()).toBe(2);

    // Le scénario du constat : on vide, puis une ligne est refusée.
    expect(() => {
      base.exec('BEGIN IMMEDIATE');
      try {
        base.exec('DELETE FROM materiels');
        base.prepare('INSERT INTO materiels (nom) VALUES (?)').run('Camion');
        base.prepare('INSERT INTO materiels (nom) VALUES (?)').run(null); // NOT NULL
        base.exec('COMMIT');
      } catch (erreur) {
        base.exec('ROLLBACK');
        throw erreur;
      }
    }).toThrow();

    // Sans transaction, il serait resté 1 ligne sur 2 attendues.
    expect(compter()).toBe(2);
    expect(base.prepare('SELECT nom FROM materiels ORDER BY id').all()).toEqual([
      { nom: 'Tracteur' },
      { nom: 'Tondeuse' },
    ]);
  });

  it('valide tout quand rien n’échoue', () => {
    base.exec('BEGIN IMMEDIATE');
    base.exec('DELETE FROM materiels');
    base.prepare('INSERT INTO materiels (nom) VALUES (?)').run('Camion');
    base.exec('COMMIT');

    expect(compter()).toBe(1);
  });
});

/**
 * 2 — Aucun moyen de révoquer une session en cours.
 *
 * Un JWT vaut par lui-même. Le seul recours était de désactiver le compte —
 * donc d'empêcher la personne de travailler — puis de le réactiver, ce qui
 * rouvrait la même faille, l'ancien jeton redevenant valable.
 */
describe('2 — une session peut être coupée', () => {
  const mw = lire('src', 'middleware', 'auth.middleware.ts');
  const auth = lire('src', 'routes', 'auth.routes.ts');
  const users = lire('src', 'routes', 'user.routes.ts');
  const migration = lire('src', 'database', 'migrations', '022_revocation_sessions.ts');
  // La signature des jetons a quitté `auth.routes.ts` pour `session.service.ts`
  // quand une deuxième porte — la passkey — a dû ouvrir des sessions à
  // l'identique. Le contrat vérifié ici est le même, à un fichier près.
  const session = lire('src', 'services', 'session.service.ts');

  it('porte un numéro de version par compte', () => {
    expect(migration).toMatch(/ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0/);
    expect(lire('src', 'database', 'migrations', 'index.ts')).toMatch(/revocationSessions/);
  });

  it('inscrit ce numéro dans le jeton et le vérifie à chaque requête', () => {
    expect(session).toMatch(/tv: user\.token_version \?\? 0/);
    expect(mw).toMatch(/\(decoded\.tv \?\? 0\) !== \(user\.token_version \?\? 0\)/);
    expect(mw).toMatch(/token_version FROM users/);
  });

  it('ne déconnecte pas les jetons émis avant la mise à jour', () => {
    // `?? 0` des deux côtés : un jeton sans `tv` est lu comme version 0,
    // celle que la migration installe.
    expect(mw).toMatch(/decoded\.tv \?\? 0/);
  });

  it('laisse le titulaire couper ses autres sessions sans se déconnecter', () => {
    expect(auth).toMatch(/router\.post\('\/revoke-sessions', authenticateToken/);
    const debut = auth.indexOf("router.post('/revoke-sessions'");
    const bloc = auth.slice(debut, auth.indexOf('});', auth.indexOf('res.json', debut)));
    expect(bloc).toMatch(/token_version = token_version \+ 1/);
    expect(bloc).toMatch(/genererJetons\(compte\)/);
  });

  it('laisse l’administrateur couper celles d’un autre compte', () => {
    expect(users).toMatch(/router\.post\('\/:id\/revoke-sessions', authenticateToken, requireAdmin/);
  });

  it('coupe les autres sessions quand on change son mot de passe', () => {
    const debut = auth.indexOf("router.put('/change-password'");
    const bloc = auth.slice(debut, auth.indexOf("router.post('/revoke-sessions'"));
    expect(bloc).toMatch(/token_version = token_version \+ 1/);
  });
});

/**
 * 3 — Pas de purge des alertes traitées.
 */
describe('3 — les alertes traitées finissent par disparaître', () => {
  const cron = lire('src', 'services', 'cron.service.ts');
  const migration = lire('src', 'database', 'migrations', '023_alertes_en_double.ts');

  it('purge chaque jour les alertes rejetées assez anciennes', () => {
    expect(cron).toMatch(/export async function purgerAlertesTraitees/);
    expect(cron).toMatch(/cron\.schedule\('30 3 \* \* \*', purgerAlertesTraitees\)/);
    expect(cron).toMatch(/DELETE FROM alerts WHERE is_dismissed = 1 AND created_at < \?/);
  });

  it('ne touche jamais une alerte encore active', () => {
    // Une échéance dépassée depuis six mois est justement celle qui doit
    // rester sous les yeux.
    expect(cron).toMatch(/is_dismissed = 1 AND created_at/);
    expect(cron).not.toMatch(/DELETE FROM alerts WHERE created_at < \?/);
  });

  it('efface les doublons déjà accumulés, en gardant le plus récent', () => {
    expect(migration).toMatch(/MAX\(id\) AS garder/);
    expect(migration).toMatch(/HAVING COUNT\(\*\) > 1/);
    expect(migration).toMatch(/id <> \?/);
    expect(lire('src', 'database', 'migrations', 'index.ts')).toMatch(/alertesEnDouble/);
  });

  it('ne suppose pas que la table existe', () => {
    expect(migration).toMatch(/tableExiste\(ctx, 'alerts'\)/);
  });
});

/**
 * 4 — Les listes fermées étaient vides à l'installation.
 *
 * La cause tenait moins à l'absence de valeurs par défaut qu'aux droits : le
 * référentiel du parc exigeait un administrateur, alors que `ReferenceSelect`
 * montre le bouton « Ajouter » dès `canManage`, qui comprend le superviseur.
 * Celui-ci voyait l'action et récoltait un 403.
 */
describe('4 — les listes fermées peuvent être remplies', () => {
  const objets = lire('src', 'routes', 'object.routes.ts');
  const base = lire('src', 'database', 'index.ts');

  it('rend le référentiel du parc au superviseur', () => {
    const referentiels = ['fuel-stations', 'maintenance-types', 'maintenance-providers', 'control-centers'];
    for (const referentiel of referentiels) {
      const motif = new RegExp(
        `router\\.(post|put|delete)\\('/${referentiel}(/:[A-Za-z]+)?', authenticateToken, requireAdmin`
      );
      expect(objets).not.toMatch(motif);
    }
    const auSuperviseur = objets.match(
      /router\.(post|put|delete)\('\/(fuel-stations|maintenance-types|maintenance-providers|control-centers)(\/:[A-Za-z]+)?', authenticateToken, requireSupervisor/g
    ) ?? [];
    expect(auSuperviseur).toHaveLength(12);
  });

  it('pose des types d’entretien à l’installation', () => {
    expect(base).toMatch(/TYPES_ENTRETIEN_PARC/);
    for (const type of ['Vidange', 'Révision', 'Pneumatiques', 'Freins']) {
      expect(base).toContain(`'${type}'`);
    }
  });

  it('n’invente ni station, ni prestataire, ni centre de contrôle', () => {
    // Ce sont des établissements nommés, propres à chaque commune : en
    // inventer reviendrait à inscrire des fournisseurs fictifs dans une base
    // municipale.
    expect(base).not.toMatch(/INSERT INTO fuel_stations \(name\) SELECT/);
    expect(base).not.toMatch(/INSERT INTO control_centers \(name\) SELECT/);
    expect(base).not.toMatch(/INSERT INTO maintenance_providers \(name\) SELECT/);
  });

  it('pose les types sans écraser ceux déjà saisis', () => {
    expect(base).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM maintenance_types WHERE name = \?\)/);
  });
});

/**
 * 5 — La limite globale était comptée par adresse IP.
 *
 * Derrière le NAT d'une mairie, les mille requêtes par quart d'heure étaient
 * partagées entre tous les agents : environ soixante-six par minute pour
 * l'ensemble du service, alors qu'une seule page en déclenche une dizaine.
 */
describe('5 — la limite de débit compte par personne', () => {
  const rl = lire('src', 'middleware', 'rateLimiter.middleware.ts');

  it('impute la requête à la personne connectée', () => {
    expect(rl).toMatch(/function cleParPersonne\(req: Request\): string/);
    expect(rl).toMatch(/keyGenerator: cleParPersonne/);
    expect(rl).toMatch(/return `u:\$\{charge\.userId\}`/);
  });

  it('vérifie la signature du jeton, sans se contenter de le décoder', () => {
    // Un identifiant forgé ouvrirait sinon un compteur neuf à volonté, ce qui
    // reviendrait à retirer la limite.
    expect(rl).toMatch(/jwt\.verify\(jeton, getJwtSecret\(\)\)/);
    expect(rl).not.toMatch(/jwt\.decode\(/);
  });

  it('retombe sur l’adresse pour le trafic anonyme', () => {
    expect(rl).toMatch(/return `ip:\$\{ipKeyGenerator/);
  });
});

/**
 * 6 — Le badge du README annonçait des tests que `npm test` n'exécutait pas.
 */
describe('6 — un seul script lance les deux suites', () => {
  const pkg = JSON.parse(lire('package.json') || '{}');

  it('enchaîne Jest et Vitest', () => {
    expect(pkg.scripts['test:client']).toBe('cd client && npm run test:run');
    expect(pkg.scripts['test:all']).toBe('npm test && npm run test:client');
  });

  it('laisse `npm test` inchangé, pour les habitudes et la CI', () => {
    expect(pkg.scripts.test).toBe('jest');
  });
});

/**
 * 5 bis — Trouvé en vérifiant le précédent : le limiteur d'authentification
 * était monté sur tout le routeur `/api/auth`, donc aussi sur `GET /me`, que
 * le client appelle à chaque ouverture de l'application. Dix appels par quart
 * d'heure — et la clé étant l'adresse IP, faute d'e-mail dans le corps d'un
 * GET, ce budget était partagé par toute la commune derrière son NAT.
 *
 * Reproduit : le onzième appel à `GET /api/auth/me` répondait 429, alors que
 * onze ouvertures de l'application en un quart d'heure n'ont rien
 * d'extraordinaire pour un service entier.
 */
describe('5 bis — consulter son profil n’est pas une tentative de connexion', () => {
  const server = lire('src', 'server.ts');
  const auth = lire('src', 'routes', 'auth.routes.ts');

  it('ne rationne plus tout le routeur d’authentification', () => {
    expect(server).not.toMatch(/app\.use\('\/api\/auth', authLimiter/);
    expect(server).toMatch(/app\.use\('\/api\/auth', authRoutes\)/);
  });

  it('le garde sur les seules routes qui éprouvent un secret', () => {
    for (const route of ['/login', '/register', '/forgot-password', '/reset-password']) {
      expect(auth).toContain(`router.post('${route}', authLimiter`);
    }
  });

  it('laisse libres les gestes de session déjà authentifiés', () => {
    for (const route of ['/me', '/logout', '/refresh']) {
      const debut = auth.indexOf(`router.${route === '/me' ? 'get' : 'post'}('${route}'`);
      expect(debut).toBeGreaterThan(-1);
      expect(auth.slice(debut, debut + 140)).not.toContain('authLimiter');
    }
  });
});
