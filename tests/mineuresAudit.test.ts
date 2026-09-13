import fs from 'fs';
import path from 'path';

/**
 * Les cinq défaillances mineures de l'audit du 13 septembre 2026.
 *
 * Aucune n'était bloquante, mais chacune se voyait à l'usage — et trois
 * d'entre elles touchent l'usage sur tablette partagée, que le README place
 * au cœur du produit.
 */

/**
 * Un fichier absent rend une chaîne vide plutôt que de faire échouer le
 * chargement de toute la suite : les assertions échouent alors une à une, en
 * disant ce qui manque.
 */
const lire = (...bouts: string[]): string => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', ...bouts), 'utf8');
  } catch {
    return '';
  }
};

/**
 * 07 — Le nom, le logo et la version de la commune n'apparaissaient pas sur
 * l'écran de connexion.
 *
 * `LoginPage` lit le magasin des réglages, que seul `Layout` — la coquille
 * authentifiée — remplissait. Avant la connexion, le magasin restait vide :
 * l'écran affichait l'initiale générique « G » et « version 1.0.0 », sa valeur
 * de repli, tandis que la barre latérale affichait bien la vraie une fois
 * connecté. Le commentaire du fichier décrivait pourtant ce défaut comme
 * corrigé : les noms de clés l'avaient été, mais personne ne remplissait le
 * magasin.
 */
describe('07 — l’écran de connexion porte les couleurs de la commune', () => {
  const routes = lire('src', 'routes', 'settings.routes.ts');
  const store = lire('client', 'src', 'stores', 'settings.store.ts');
  const login = lire('client', 'src', 'pages', 'LoginPage.tsx');

  it('expose une route de réglages ouverte, sans authentification', () => {
    expect(routes).toMatch(/router\.get\('\/public', async/);
  });

  it('n’y expose que l’apparence', () => {
    const declaration = routes.match(/const REGLAGES_PUBLICS = \[(.*?)\]/s);
    expect(declaration).not.toBeNull();
    const cles = declaration![1];
    for (const attendue of ['site_name', 'site_logo', 'site_favicon', 'site_version']) {
      expect(cles).toContain(attendue);
    }
    // Rien qui touche à la sauvegarde, au SMTP ou au mode maintenance.
    for (const interdite of ['smtp', 'backup', 'maintenance_mode', 'site_url']) {
      expect(cles).not.toContain(interdite);
    }
  });

  it('déclare la route publique avant celle qui exige un jeton', () => {
    expect(routes.indexOf("router.get('/public'")).toBeLessThan(
      routes.indexOf("router.get('/', authenticateToken")
    );
  });

  it('donne au magasin de quoi la lire, et à l’écran de quoi la demander', () => {
    expect(store).toMatch(/fetchPublicSettings: async \(\) => \{/);
    expect(store).toMatch(/api\.get\('\/settings\/public'\)/);
    expect(login).toMatch(/fetchPublicSettings\(\)/);
    expect(login).toMatch(/useEffect\(/);
  });
});

/**
 * 08 — Le cache des réponses API n'était pas vidé à la déconnexion.
 *
 * Le service worker garde 24 h de réponses `/api/` en NetworkFirst.
 * `logout()` effaçait l'état d'authentification, mais aucun `caches.delete`
 * n'existait dans le client : sur la tablette partagée d'un service
 * technique, l'agent suivant pouvait voir hors réseau les données consultées
 * par le précédent.
 */
describe('08 — la déconnexion vide le cache des réponses API', () => {
  const auth = lire('client', 'src', 'stores', 'auth.store.ts');

  it('efface le cache `api-cache` en se déconnectant', () => {
    const debut = auth.indexOf('logout: () => {');
    expect(debut).toBeGreaterThan(-1);
    const corps = auth.slice(debut, auth.indexOf('checkAuth:', debut));
    expect(corps).toMatch(/caches\s*\n?\s*\.keys\(\)/);
    expect(corps).toMatch(/caches\.delete\(/);
    expect(corps).toMatch(/api-cache/);
  });

  it('ne suppose pas que `caches` existe', () => {
    // Navigation privée, contexte non sécurisé, tests : l'API peut manquer.
    expect(auth).toMatch(/typeof caches !== 'undefined'/);
  });
});

/**
 * 09 — La file hors réseau ne portait pas l'identité de l'agent.
 *
 * `QueuedMutation` retenait l'URL, la méthode, le corps et un libellé, mais
 * pas l'utilisateur. Sur une tablette partagée, l'agent A pouvait saisir un
 * plein hors réseau puis fermer sa session ; au retour du réseau, l'agent B
 * connecté rejouait la saisie avec son propre jeton, et le plein lui était
 * porté au compte.
 *
 * Second point du même constat : le rejeu n'était déclenché que par
 * l'événement `online`, qui ne survient qu'au changement d'état. Rouvrir
 * l'application déjà connectée, la file pleine, n'envoyait rien.
 */
describe('09 — la file hors réseau sait qui a saisi', () => {
  const queue = lire('client', 'src', 'lib', 'offlineQueue.ts');
  const api = lire('client', 'src', 'lib', 'api.ts');
  const banniere = lire('client', 'src', 'components', 'OfflineBanner.tsx');

  it('retient l’auteur de chaque saisie', () => {
    expect(queue).toMatch(/userId\?: number/);
    expect(api).toMatch(/userId: useAuthStore\.getState\(\)\.user\?\.id/);
  });

  it('ne compte et ne rejoue que les saisies de la personne connectée', () => {
    expect(queue).toMatch(/async list\(userId\?: number\)/);
    expect(queue).toMatch(/async count\(userId\?: number\)/);
    expect(queue).toMatch(/async flush\(/);
    expect(banniere).toMatch(/offlineQueue\.count\(utilisateurId\)/);
    expect(banniere).toMatch(/offlineQueue\.flush\(envoyer, utilisateurId\)/);
  });

  it('tente un envoi au montage, une seule fois', () => {
    expect(banniere).toMatch(/essaiAuMontage/);
    expect(banniere).toMatch(/navigator\.onLine\) vider\(\)/);
  });
});

/**
 * La règle de filtrage de la file vaut d'être éprouvée pour elle-même : c'est
 * elle qui décide à qui appartient une saisie en attente.
 */
describe('09 — à qui appartient une saisie en attente', () => {
  // Reprise à l'identique du prédicat de `offlineQueue.list`.
  const luiRevient = (saisie: { userId?: number }, userId?: number) =>
    userId === undefined || saisie.userId === undefined || saisie.userId === userId;

  it('rend tout quand personne n’est connecté', () => {
    expect(luiRevient({ userId: 7 }, undefined)).toBe(true);
  });

  it('rend à chacun les siennes', () => {
    expect(luiRevient({ userId: 7 }, 7)).toBe(true);
    expect(luiRevient({ userId: 7 }, 8)).toBe(false);
  });

  it('laisse rejouables les saisies d’avant la version, plutôt que de les perdre', () => {
    expect(luiRevient({}, 8)).toBe(true);
  });
});

/**
 * 10 — Les liens de téléchargement de sauvegarde mouraient au redémarrage.
 *
 * Ils vivaient dans une `Map` en mémoire. Un lien annoncé pour sept jours ne
 * survivait pas au premier redémarrage du serveur, et son destinataire
 * tombait sur « lien invalide ou expiré », ce qui n'était ni l'un ni l'autre.
 */
describe('10 — un lien de sauvegarde survit au redémarrage', () => {
  const backup = lire('src', 'routes', 'backup.routes.ts');
  const migration = lire('src', 'database', 'migrations', '021_liens_sauvegarde.ts');
  const index = lire('src', 'database', 'migrations', 'index.ts');

  it('ne garde plus les jetons en mémoire', () => {
    expect(backup).not.toMatch(/downloadTokens/);
    expect(backup).not.toMatch(/new Map\(\)/);
  });

  it('les écrit, les lit et les oublie en base', () => {
    expect(backup).toMatch(/INSERT INTO backup_download_tokens/);
    expect(backup).toMatch(/SELECT backup_id, expires_at, created_by FROM backup_download_tokens/);
    expect(backup).toMatch(/DELETE FROM backup_download_tokens WHERE token = \?/);
  });

  it('fait le ménage des liens périmés', () => {
    expect(backup).toMatch(/DELETE FROM backup_download_tokens WHERE expires_at < \?/);
  });

  it('porte une migration, déclarée dans la liste', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS backup_download_tokens/);
    expect(migration).toMatch(/ON DELETE CASCADE/);
    expect(index).toMatch(/liensSauvegarde/);
  });
});

/**
 * 11 — Un plugin déclarant un envoi de fichier recevait un succès qui n'en
 * était pas un : `res.json({ success: true, message: 'Upload endpoint - à
 * implémenter avec multer' })`. Le plugin croyait son fichier enregistré.
 */
describe('11 — un envoi non implémenté ne se présente plus comme réussi', () => {
  const routes = lire('src', 'routes', 'plugin.routes.ts');
  const service = lire('src', 'services', 'pluginAdvanced.service.ts');

  it('répond un refus franc plutôt qu’un succès', () => {
    expect(routes).not.toMatch(/à implémenter avec multer/);
    const debut = routes.indexOf("if (matchedEndpoint.action === 'upload')");
    expect(debut).toBeGreaterThan(-1);
    const bloc = routes.slice(debut, debut + 320);
    expect(bloc).toMatch(/status\(501\)/);
    expect(bloc).toMatch(/success: false/);
  });

  it('borne le nom de table qu’un plugin fait créer ou supprimer', () => {
    expect(service).toMatch(/export function nomTableSur\(/);
    expect(service).toMatch(/CREATE TABLE IF NOT EXISTS \$\{nomTableSur\(table\.name\)\}/);
    expect(service).toMatch(/DROP TABLE IF EXISTS \$\{nomTableSur\(table\.name\)\}/);
  });
});

/**
 * La règle du nom de table, éprouvée directement.
 */
describe('11 — ce qu’un nom de table de plugin peut contenir', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { nomTableSur } = require('../src/services/pluginAdvanced.service');

  it('accepte un nom ordinaire', () => {
    expect(nomTableSur('plugin_donnees')).toBe('plugin_donnees');
    expect(nomTableSur('Releves2')).toBe('Releves2');
  });

  it('refuse tout ce qui permettrait d’en dire plus', () => {
    for (const nom of [
      'objects; DROP TABLE users',
      'a b',
      'users--',
      '2tables',
      '',
      'plugin.donnees',
      '"objects"',
      null,
      undefined,
      42,
    ]) {
      expect(() => nomTableSur(nom)).toThrow(/Nom de table de plugin invalide/);
    }
  });
});
