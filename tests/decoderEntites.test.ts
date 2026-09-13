import { decoderEntites, decoderEntitesOuNull, porteDesEntites } from '../src/utils/decoderEntites';
import { lireLibelle } from '../src/services/snipeItLibelle.service';

/**
 * Décodage des textes repris de Snipe-IT.
 *
 * Snipe-IT est une application Laravel dont l'API rend ses champs déjà échappés
 * pour un affichage web. Une barrière nommée « Rad'o » en ressort en
 * « Rad&#039;o », et recopiée telle quelle elle reste illisible partout : sur la
 * fiche, dans le référentiel des lieux, et jusque sur l'étiquette collée au
 * trousseau — là où personne ne peut plus la corriger.
 *
 * Les cas ci-dessous sont ceux relevés dans un parc communal réel.
 */

describe('Entités rencontrées dans un vrai inventaire', () => {
  it.each([
    ['barrière arrière Rad&#039;o', "barrière arrière Rad'o"],
    ['barrière avant Rad&#039;o', "barrière avant Rad'o"],
    ['Atelier &amp; garage', 'Atelier & garage'],
    ['Salle &quot;Jean Moulin&quot;', 'Salle "Jean Moulin"'],
    ['Local L&#39;Escale', "Local L'Escale"],
    ['Entrée &lt;principale&gt;', 'Entrée <principale>'],
  ])('%s', (echappe, attendu) => {
    expect(decoderEntites(echappe)).toBe(attendu);
  });

  it('laisse intact un texte sans entité', () => {
    expect(decoderEntites('Barrière Dame Blanche')).toBe('Barrière Dame Blanche');
    expect(decoderEntites('Casier Cantine Jean Maillard')).toBe('Casier Cantine Jean Maillard');
  });

  it('décode un texte échappé deux fois', () => {
    // Un copier-coller déjà échappé, saisi dans Snipe-IT, ressort doublement.
    expect(decoderEntites('Rad&amp;#039;o')).toBe("Rad'o");
  });

  it('laisse une entité inconnue plutôt que d’inventer un caractère', () => {
    expect(decoderEntites('Mairie &copy; 2026')).toBe('Mairie &copy; 2026');
  });

  it('gère le décimal et l’hexadécimal', () => {
    expect(decoderEntites('&#233;cole')).toBe('école');
    expect(decoderEntites('&#xe9;cole')).toBe('école');
  });
});

describe('Variante préservant null', () => {
  it('rend null sur une valeur absente ou vide', () => {
    expect(decoderEntitesOuNull(null)).toBeNull();
    expect(decoderEntitesOuNull(undefined)).toBeNull();
    expect(decoderEntitesOuNull('   ')).toBeNull();
  });

  it('décode et rogne sinon', () => {
    expect(decoderEntitesOuNull('  Rad&#039;o  ')).toBe("Rad'o");
  });
});

describe('Détection, pour repérer une donnée à réparer', () => {
  it('reconnaît une entité', () => {
    expect(porteDesEntites('Rad&#039;o')).toBe(true);
    expect(porteDesEntites('Atelier &amp; garage')).toBe(true);
  });

  it('ne se déclenche pas sur une esperluette ordinaire', () => {
    expect(porteDesEntites('Atelier & garage')).toBe(false);
    expect(porteDesEntites('Barrière Dame Blanche')).toBe(false);
  });

  it('rend le même résultat appelé deux fois de suite', () => {
    // Un motif global garderait `lastIndex` d'un appel à l'autre et
    // alternerait vrai/faux sur la même chaîne.
    const texte = 'Rad&#039;o';
    expect(porteDesEntites(texte)).toBe(true);
    expect(porteDesEntites(texte)).toBe(true);
  });
});

describe('Le décodage précède la lecture du libellé', () => {
  it('permet de séparer un libellé dont l’entité masquait la structure', () => {
    // Décodé, le libellé se lit normalement ; échappé, l'apostrophe polluait
    // le nom du site créé dans le référentiel.
    const lu = lireLibelle(decoderEntites('Clé Local L&#039;Escale - Réserve'));
    expect(lu.site).toBe("Local L'Escale");
    expect(lu.ouvrant).toBe('Réserve');
  });
});
