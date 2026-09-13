import fs from 'fs';
import path from 'path';
import {
  loadPluginPages,
  savePluginPages,
  deletePluginPages,
} from '../src/services/pluginAdvanced.service';

/**
 * Traversée de chemin sur les pages de plugins.
 *
 * `GET /api/plugins/:slug/pages/:pageName` passait son `slug` tel quel à
 * `path.join`. Express décode `%2F` avant de remplir `req.params` : l'appel
 *
 *     GET /api/plugins/..%2F..%2Fdata%2Fsecret/pages/confidentiel
 *
 * arrivait donc au service sous la forme `../../data/secret`, et le serveur
 * rendait le contenu du fichier avec un 200. Vérifié avec le rôle `user`, le
 * plus bas de tous : un compte en consultation seule lisait n'importe quel
 * fichier `.json` du volume — sauvegardes exportées, configurations de service.
 *
 * L'écriture et la suppression suivaient le même chemin, en pire :
 * `deletePluginPages('..')` résout vers `plugins` et efface le dossier entier,
 * `savePluginPages(slug, { '../../evade': … })` écrit hors de son dossier.
 * Les deux ont été constatés pour de vrai en exécutant ces tests contre le
 * code d'avant.
 *
 * D'où la forme retenue ici : pendant les cas hostiles, les trois écritures de
 * `fs` sont remplacées par des sentinelles qui échouent si on les appelle. Le
 * test vérifie ainsi deux choses à la fois — le refus est bien levé, et il
 * l'est *avant* que le disque ne soit touché — sans pouvoir rien détruire le
 * jour où quelqu'un retire le garde.
 *
 * La route voisine `GET /:slug/pages` vérifiait, elle, que le plugin existait
 * en base. C'est cet écart entre deux routes jumelles qui a ouvert le trou :
 * d'où le dernier test, structurel, qui interdit de reconstruire un chemin de
 * pages ailleurs que dans le garde.
 */

const SLUGS_HOSTILES = [
  '../../data/secret',
  '../..',
  '..',
  '.',
  'plugins/../../data',
  'dossier/enfant',
  'dossier\\enfant',
  '/etc/passwd',
  'C:\\Windows',
  'plugin.json',
  '',
];

/** Toute écriture pendant un cas hostile est en soi un échec. */
function scellerLeDisque() {
  const refus = (nom: string) => () => {
    throw new Error(`Le disque a été touché (${nom}) avant le refus du slug`);
  };
  return [
    jest.spyOn(fs, 'rmSync').mockImplementation(refus('rmSync') as never),
    jest.spyOn(fs, 'writeFileSync').mockImplementation(refus('writeFileSync') as never),
    jest.spyOn(fs, 'mkdirSync').mockImplementation(refus('mkdirSync') as never),
    jest.spyOn(fs, 'readdirSync').mockImplementation(refus('readdirSync') as never),
  ];
}

describe('Pages de plugins : un slug ne sort pas de son dossier', () => {
  let sentinelles: jest.SpyInstance[] = [];

  beforeEach(() => {
    sentinelles = scellerLeDisque();
  });

  afterEach(() => {
    sentinelles.forEach((s) => s.mockRestore());
  });

  it.each(SLUGS_HOSTILES)('loadPluginPages refuse « %s »', (slug) => {
    expect(() => loadPluginPages(slug)).toThrow(/Slug de plugin invalide/);
  });

  it.each(SLUGS_HOSTILES)('savePluginPages refuse « %s »', (slug) => {
    expect(() => savePluginPages(slug, {} as any)).toThrow(/Slug de plugin invalide/);
  });

  it.each(SLUGS_HOSTILES)('deletePluginPages refuse « %s »', (slug) => {
    expect(() => deletePluginPages(slug)).toThrow(/Slug de plugin invalide/);
  });

  it('refuse un nom de page qui remonte, le nom devenant un nom de fichier', () => {
    expect(() =>
      savePluginPages('audit-chemin', { '../../evade': { titre: 'x' } } as any)
    ).toThrow(/Nom de page invalide/);
  });
});

describe('Pages de plugins : le fonctionnement normal est préservé', () => {
  const SLUG = 'audit-chemin-plugin';
  const dossier = path.join('./plugins/pages', SLUG);

  afterAll(() => {
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  it('rend un objet vide pour un slug valide mais inconnu, sans lever', () => {
    expect(loadPluginPages('plugin-absent-du-disque')).toEqual({});
  });

  it('écrit puis relit les pages d’un slug légitime', () => {
    savePluginPages(SLUG, {
      index: { titre: 'Accueil' },
      'ma_page-2': { titre: 'Seconde' },
    } as any);

    expect(fs.existsSync(path.join(dossier, 'index.json'))).toBe(true);

    const pages = loadPluginPages(SLUG);
    expect(Object.keys(pages).sort()).toEqual(['index', 'ma_page-2']);
    expect((pages.index as any).titre).toBe('Accueil');
  });

  it('supprime le dossier d’un slug légitime', () => {
    savePluginPages(SLUG, { index: { titre: 'Accueil' } } as any);
    deletePluginPages(SLUG);
    expect(fs.existsSync(dossier)).toBe(false);
  });
});

describe('Pages de plugins : le chemin ne se reconstruit qu’au même endroit', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'pluginAdvanced.service.ts'),
    'utf8'
  );

  it('ne joint PLUGIN_PAGES_DIR à un slug que dans le garde', () => {
    const jointures = source.match(/path\.join\(\s*PLUGIN_PAGES_DIR/g) ?? [];
    expect(jointures).toHaveLength(1);
    expect(source).toMatch(/function dossierDesPages/);
  });

  it('fait vérifier au détail d’une page que le plugin existe en base', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'plugin.routes.ts'),
      'utf8'
    );
    const debut = route.indexOf("router.get('/:slug/pages/:pageName'");
    expect(debut).toBeGreaterThan(-1);

    const handler = route.slice(debut, route.indexOf('loadPluginPages', debut));
    expect(handler).toMatch(/FROM plugins WHERE slug = \?/);
  });
});
