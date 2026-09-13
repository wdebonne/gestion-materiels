import fs from 'fs';
import path from 'path';

/**
 * Qui constate, et qui arbitre.
 *
 * Tout le module Manifestations était gardé par `requireSupervisor`, y compris
 * la saisie de ce qui part et de ce qui revient. Le rôle `agent` — « saisit sur
 * le terrain » — ne pouvait donc rien pointer : un superviseur ressaisissait le
 * soir ce qu'un autre avait vu le matin, et c'est à cette ressaisie que les
 * quantités se perdent.
 *
 * Le partage retenu : l'agent **constate** — livré, récupéré, cassé, état au
 * retour — et n'**arbitre** pas. Ramener une demande de dix tables à huit engage
 * la collectivité vis-à-vis du demandeur ; prononcer une livraison est un acte
 * administratif. Les deux restent au superviseur.
 *
 * Ce test lit les routes elles-mêmes : une garde relâchée par mégarde sur la
 * demande, le statut ou la suppression le fait échouer, alors qu'une relecture à
 * l'œil ne le verrait pas dans deux mille lignes.
 */

const ROUTES = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'manifestation.routes.ts'),
  'utf8'
);

/**
 * La garde posée sur une route, telle qu'elle est écrite.
 *
 * Lue entre la déclaration et le premier `async` : certaines routes glissent un
 * tableau de validateurs entre les deux, et s'arrêter à la première parenthèse
 * fermante ferait passer leur garde pour absente.
 */
function gardeDe(methode: string, chemin: string): string | null {
  const debut = ROUTES.indexOf(`router.${methode}('${chemin}'`);
  if (debut === -1) return null;
  const finEntete = ROUTES.indexOf('async', debut);
  if (finEntete === -1) return null;

  const entete = ROUTES.slice(debut, finEntete);
  for (const garde of ['requireAdmin', 'requireSupervisor', 'requireFieldWrite']) {
    if (entete.includes(garde)) return garde;
  }
  return 'authenticateToken';
}

describe("la saisie de terrain est ouverte à l'agent", () => {
  it.each([
    ['put', '/:id/materials', 'les quantités livrées, récupérées et perdues'],
    ['put', '/:id/objects/:itemId', "la sortie, le retour et l'état d'un matériel du parc"],
  ])('%s %s — %s', (methode, chemin) => {
    expect(gardeDe(methode, chemin)).toBe('requireFieldWrite');
  });

  it('vérifie la portée du compte sur chaque saisie', () => {
    // Ces routes n'étaient ouvertes qu'aux superviseurs, qui voient tout : le
    // périmètre n'y avait jamais été contrôlé. Un agent, lui, ne voit qu'une
    // partie des manifestations.
    for (const chemin of ["'/:id/materials'", "'/:id/objects/:itemId'"]) {
      const debut = ROUTES.indexOf(`router.put(${chemin}`);
      expect(debut).toBeGreaterThan(-1);
      const corps = ROUTES.slice(debut, debut + 1200);
      expect(corps).toContain('peutVoirManifestation');
    }
  });
});

describe("ce qui reste au superviseur", () => {
  it.each([
    ['put', '/:id', 'modifier la demande elle-même'],
    ['put', '/:id/objects', 'remplacer le matériel du parc demandé'],
    ['put', '/:id/status', 'prononcer la validation, la livraison, la récupération'],
    ['post', '/', 'créer une manifestation'],
    ['delete', '/:id', 'supprimer'],
  ])('%s %s — %s', (methode, chemin) => {
    expect(gardeDe(methode, chemin)).toBe('requireSupervisor');
  });

  it("ne laisse pas un agent corriger la quantité demandée", () => {
    // La route accepte `quantity_requested` : sans ce partage, l'ouvrir aux
    // agents leur donnait au passage le droit de réécrire la demande — et
    // l'écart entre le promis et le livré, qui est précisément ce qu'on veut
    // pouvoir constater, disparaissait de lui-même.
    expect(ROUTES).toContain('const peutCorrigerLaDemande');
    expect(ROUTES).toMatch(/peutCorrigerLaDemande\(req\.user!\.role\)\s*\?\s*mat\.quantity_requested/);
  });
});

describe("l'écran dit la même chose que le serveur", () => {
  it('accorde la saisie aux mêmes rôles des deux côtés', () => {
    // Un bouton montré à quelqu'un que le serveur va refuser est pire que pas de
    // bouton : l'agent remplit un formulaire pour rien.
    const middleware = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'middleware', 'auth.middleware.ts'),
      'utf8'
    );
    const permissions = fs.readFileSync(
      path.join(__dirname, '..', 'client', 'src', 'lib', 'permissions.ts'),
      'utf8'
    );

    const serveur = middleware
      .match(/requireFieldWrite = requireRole\(([^)]*)\)/)![1]
      .match(/'([a-z]+)'/g)!
      .map((r) => r.replace(/'/g, ''));
    const ecran = permissions
      .match(/FIELD_WRITE_ROLES: readonly Role\[\] = \[([^\]]*)\]/)![1]
      .match(/'([a-z]+)'/g)!
      .map((r) => r.replace(/'/g, ''));

    expect(ecran.sort()).toEqual(serveur.sort());
    expect(serveur).toContain('agent');
  });
});
