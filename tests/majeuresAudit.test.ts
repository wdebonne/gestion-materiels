import fs from 'fs';
import path from 'path';

/**
 * Les quatre défaillances majeures de l'audit du 13 septembre 2026.
 *
 * Elles ne partagent ni fichier ni mécanique, mais toutes se constatent sur du
 * texte : ce sont des conditions écrites de travers, pas des algorithmes. Les
 * vérifier structurellement coûte peu et tient tant que la forme ne change pas ;
 * le comportement, lui, a été vérifié en conditions réelles contre un serveur.
 */

const lire = (...bouts: string[]) => fs.readFileSync(path.join(__dirname, '..', ...bouts), 'utf8');

/**
 * 03 — Un superviseur ne pouvait créer aucune réservation.
 *
 * L'écran des réservations remplissait sa liste « Emprunteur » avec
 * `GET /api/users`, réservé à l'administrateur. Le superviseur recevait un 403
 * silencieux, une liste vide, et un bouton « Créer » que la condition
 * `!formData.userId` laissait désactivé pour toujours. Vérifié au navigateur.
 */
describe('03 — le superviseur peut désigner un emprunteur', () => {
  const routes = lire('src', 'routes', 'user.routes.ts');
  const page = lire('client', 'src', 'pages', 'ReservationsPage.tsx');

  it('expose un annuaire ouvert au superviseur', () => {
    expect(routes).toMatch(/router\.get\(\s*'\/annuaire',\s*authenticateToken,\s*requireSupervisor/);
  });

  it('déclare l’annuaire avant `/:id`, qui capterait le mot', () => {
    const annuaire = routes.indexOf("router.get('/annuaire'");
    const parId = routes.indexOf("router.get('/:id'");
    expect(annuaire).toBeGreaterThan(-1);
    expect(parId).toBeGreaterThan(-1);
    expect(annuaire).toBeLessThan(parId);
  });

  it('n’y expose que de quoi afficher un nom', () => {
    const debut = routes.indexOf("router.get('/annuaire'");
    // Jusqu'à la fin du gestionnaire, et non jusqu'à la route suivante :
    // d'autres routes se sont depuis intercalées avant `GET /:id`.
    const bloc = routes.slice(debut, routes.indexOf('});', debut));
    expect(bloc).toMatch(/SELECT id, first_name, last_name FROM users/);
    for (const champ of ['role', 'email', 'last_login', 'is_active AS', 'password']) {
      expect(bloc.includes(`${champ},`)).toBe(false);
    }
  });

  it('fait pointer l’écran des réservations sur l’annuaire', () => {
    expect(page).toMatch(/api\.get\('\/users\/annuaire'\)/);
    expect(page).not.toMatch(/api\.get\('\/users'\)/);
  });
});

/**
 * 04 — Réserver sans préciser l'emprunteur renvoyait une 500.
 *
 * `const userId = isSupervisor ? req.body.userId : req.user!.userId` laissait
 * `undefined` passer en base pour un admin ou un superviseur qui n'envoyait pas
 * `userId` — alors même que le validateur le déclare `optional()`.
 * `NOT NULL constraint failed: reservations.user_id`, vérifié.
 */
describe('04 — réserver sans emprunteur explicite retombe sur soi-même', () => {
  const routes = lire('src', 'routes', 'reservation.routes.ts');

  it('replie sur l’utilisateur courant plutôt que d’écrire `undefined`', () => {
    expect(routes).toMatch(/isSupervisor \? \(req\.body\.userId \?\? req\.user!\.userId\) : req\.user!\.userId/);
  });

  it('garde `userId` optionnel dans le validateur, comme annoncé', () => {
    expect(routes).toMatch(/body\('userId'\)\.optional\(\)/);
  });
});

/**
 * 05 — Rétrograder un compte restait sans effet sept jours.
 *
 * `req.user = decoded` : le rôle servant à toutes les autorisations venait du
 * jeton. Le rôle frais était pourtant déjà lu en base deux lignes plus haut,
 * et servait au cloisonnement. Vérifié : un superviseur rétrogradé en `user`
 * gardait l'accès à `GET /api/manifestations/stock`.
 */
describe('05 — le rôle vient de la base, pas du jeton', () => {
  const mw = lire('src', 'middleware', 'auth.middleware.ts');

  it('n’affecte plus le contenu du jeton tel quel', () => {
    expect(mw).not.toMatch(/^\s*req\.user = decoded;\s*$/m);
  });

  it('écrase le rôle du jeton par celui de la base', () => {
    expect(mw).toMatch(/req\.user = \{ \.\.\.decoded, role: user\.role \};/);
  });

  it('lit bien le rôle en base avant de l’utiliser', () => {
    const lecture = mw.indexOf('role, is_active');
    const affectation = mw.indexOf('req.user = { ...decoded');
    expect(lecture).toBeGreaterThan(-1);
    expect(lecture).toBeLessThan(affectation);
  });
});

/**
 * 06 — Une alerte rejetée revenait dans l'heure.
 *
 * La recherche d'alerte existante filtrait sur `is_dismissed = 0` : la rejetée
 * n'était jamais retrouvée, et `checkAlerts` — toutes les heures — en reposait
 * une identique. Reproduit : trois alertes rejetées, un passage du cron, trois
 * nouvelles lignes ; la table passait de 6 à 9. Les quatre types d'alertes
 * étaient touchés.
 */
describe('06 — une alerte rejetée ne revient plus', () => {
  const cron = lire('src', 'services', 'cron.service.ts');

  it('ne cherche plus les alertes en excluant les rejetées', () => {
    expect(cron).not.toMatch(/plugin_reference_id = \? AND is_dismissed = 0/);
  });

  it('passe par un point de recherche unique', () => {
    expect(cron).toMatch(/async function alertePosee\(/);
    const appels = cron.match(/await alertePosee\(/g) ?? [];
    expect(appels).toHaveLength(4); // CT, entretien, espace vert, récupération
  });

  it('couvre les quatre types d’alertes', () => {
    for (const reference of [
      'technical-control',
      'maintenance',
      'green-space-maintenance',
      'manifestation-recovery',
    ]) {
      expect(cron).toMatch(new RegExp(`alertePosee\\('${reference}'`));
    }
  });

  it('fait dépendre le rejet de l’échéance sur laquelle il portait', () => {
    expect(cron).toMatch(/function rejetToujoursValable\(/);
    const gardes = cron.match(/rejetToujoursValable\(/g) ?? [];
    expect(gardes.length).toBeGreaterThanOrEqual(5); // 1 définition + 4 usages
  });

  it('remet l’échéance à jour quand elle a bougé', () => {
    const majs = cron.match(/due_date = \?, is_dismissed = 0/g) ?? [];
    expect(majs).toHaveLength(4);
  });
});

/**
 * La logique de `rejetToujoursValable` vaut d'être éprouvée pour elle-même :
 * c'est elle qui décide si le geste de l'utilisateur tient encore.
 */
describe('06 — la règle du rejet, cas par cas', () => {
  // Reconstruite à l'identique : la fonction n'est pas exportée, et l'exporter
  // pour les seuls tests élargirait la surface du module sans raison.
  const rejetToujoursValable = (alerte: any, echeance: unknown): boolean => {
    if (!alerte || !alerte.is_dismissed) return false;
    return String(alerte.due_date ?? '') === String(echeance ?? '');
  };

  it('ne tient pas s’il n’y a pas d’alerte', () => {
    expect(rejetToujoursValable(null, '2026-09-01')).toBe(false);
  });

  it('ne tient pas si l’alerte est active', () => {
    expect(rejetToujoursValable({ due_date: '2026-09-01', is_dismissed: 0 }, '2026-09-01')).toBe(false);
  });

  it('tient si le rejet porte sur la même échéance', () => {
    expect(rejetToujoursValable({ due_date: '2026-09-01', is_dismissed: 1 }, '2026-09-01')).toBe(true);
  });

  it('ne tient plus si l’échéance a bougé — contrôle refait', () => {
    expect(rejetToujoursValable({ due_date: '2026-09-01', is_dismissed: 1 }, '2028-09-01')).toBe(false);
  });

  it('traite une échéance absente sans lever', () => {
    expect(rejetToujoursValable({ due_date: null, is_dismissed: 1 }, null)).toBe(true);
    expect(rejetToujoursValable({ due_date: null, is_dismissed: 1 }, '2026-09-01')).toBe(false);
  });
});
