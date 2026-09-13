import { lireLibelle, regrouperSites, cleDeSite } from '../src/services/snipeItLibelle.service';

/**
 * Lecture des libellés Snipe-IT.
 *
 * Snipe-IT ne sait pas dire ce qu'une clé ouvre : la notion n'existe pas chez
 * lui et ses composants n'acceptent pas de champ personnalisé. L'information
 * n'est donc que dans le nom, écrit à la main par des agents successifs sur
 * plusieurs années — avec des séparateurs différents, des accents inconstants
 * et des abréviations maison.
 *
 * Ces tests fixent ce que la lecture a le droit de conclure, et surtout ce
 * qu'elle doit refuser de conclure. Un rattachement faux n'est pas une donnée
 * approximative : c'est quelqu'un devant la mauvaise porte un dimanche soir.
 * D'où la `confiance`, que l'écran traduit en « à vérifier » avant d'écrire.
 */

describe('Un libellé en deux parties se lit sûrement', () => {
  it.each([
    ['Clé Mairie - Porte principale', 'Mairie', 'Porte principale'],
    ['Clé Mairie – Porte principale', 'Mairie', 'Porte principale'],
    ['Badge Mairie / Salle du conseil', 'Mairie', 'Salle du conseil'],
    ['Mairie : Archives', 'Mairie', 'Archives'],
    ['CLEF ATELIER > Vestiaires', 'ATELIER', 'Vestiaires'],
  ])('%s', (libelle, site, ouvrant) => {
    const lu = lireLibelle(libelle);
    expect(lu).toMatchObject({ site, ouvrant, estPasse: false, confiance: 'sure' });
  });

  it('garde les parties suivantes quand il y en a plus de deux', () => {
    const lu = lireLibelle('Clé Mairie - Étage 1 - Bureau du maire');
    expect(lu.site).toBe('Mairie');
    expect(lu.ouvrant).toBe('Étage 1 – Bureau du maire');
  });
});

describe('Un passe ouvre le site, pas une porte', () => {
  it.each([
    ['Passe Mairie', 'Mairie'],
    ['Pass Mairie', 'Mairie'],
    ['Clé passe Mairie', 'Mairie'],
    ['PASSE GENERAL Ecoles', 'Ecoles'],
    ['Passe général écoles', 'écoles'],
    ['Clé maîtresse Gymnase', 'Gymnase'],
    ['PTT Mairie', 'Mairie'],
  ])('%s', (libelle, site) => {
    const lu = lireLibelle(libelle);
    expect(lu).toMatchObject({ site, estPasse: true, confiance: 'sure' });
    // Un passe ne doit jamais produire d'ouvrant : il vaut pour tout le site,
    // y compris les portes créées après coup.
    expect(lu.ouvrant).toBeUndefined();
  });

  it('replie une précision dans le nom du site plutôt que d’inventer une porte', () => {
    const lu = lireLibelle('Passe Mairie - bâtiment A');
    expect(lu.estPasse).toBe(true);
    expect(lu.site).toBe('Mairie bâtiment A');
    expect(lu.ouvrant).toBeUndefined();
  });
});

describe('Ce que la lecture refuse de conclure', () => {
  it('ne tient qu’une partie pour probable, pas pour sûre', () => {
    // « Local technique » est-il un bâtiment, ou une porte dans un bâtiment
    // qu'on n'a pas nommé ? Rien dans le libellé ne le dit.
    const lu = lireLibelle('Clé Local technique');
    expect(lu).toMatchObject({ site: 'Local technique', confiance: 'probable' });
  });

  it('rend « aucune » sur un libellé vide ou réduit à sa nature', () => {
    expect(lireLibelle('')).toMatchObject({ confiance: 'aucune' });
    expect(lireLibelle('   ')).toMatchObject({ confiance: 'aucune' });
    expect(lireLibelle('Clé')).toMatchObject({ confiance: 'aucune' });
    expect(lireLibelle('Badge')).toMatchObject({ confiance: 'aucune' });
  });

  it('ne coupe pas un nom propre qui porte un trait d’union', () => {
    // « Jean-Jacques Rousseau » est une école, pas une séparation. Seul un
    // tiret entouré d'espaces sépare.
    const lu = lireLibelle('Clé École Jean-Jacques Rousseau');
    expect(lu.site).toBe('École Jean-Jacques Rousseau');
    expect(lu.ouvrant).toBeUndefined();
  });

  it('n’invente pas de site quand le préfixe a tout consommé', () => {
    const lu = lireLibelle('Clé - Porte principale');
    expect(lu.site).toBeUndefined();
    expect(lu.ouvrant).toBe('Porte principale');
    expect(lu.confiance).toBe('probable');
  });
});

describe('Regroupement des sites', () => {
  it('réunit les écritures d’un même bâtiment', () => {
    const lectures = [
      lireLibelle('Clé Ecole J. Ferry - Portail'),
      lireLibelle('Clé École J.Ferry - Préau'),
      lireLibelle('Passe ECOLE J FERRY'),
      lireLibelle('Clé Mairie - Archives'),
    ];

    const sites = regrouperSites(lectures);
    // Trois écritures, un seul bâtiment : les importer séparément donnerait
    // trois sites que personne ne penserait à fusionner ensuite.
    expect(sites.size).toBe(2);
    expect([...sites.values()]).toContain('Mairie');
  });

  it('retient la première écriture rencontrée, qui reste modifiable', () => {
    const sites = regrouperSites([
      lireLibelle('Clé Ecole J. Ferry - Portail'),
      lireLibelle('Clé École J.Ferry - Préau'),
    ]);
    expect([...sites.values()]).toEqual(['Ecole J. Ferry']);
  });

  it('rapproche sur une forme insensible aux accents et à la ponctuation', () => {
    expect(cleDeSite('École J.Ferry')).toBe(cleDeSite('ecole j ferry'));
    expect(cleDeSite('Mairie')).not.toBe(cleDeSite('Gymnase'));
  });
});
