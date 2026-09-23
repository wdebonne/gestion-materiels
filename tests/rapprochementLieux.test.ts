import {
  decouperLieux,
  rapprocherDansReferentiel,
  type LieuReference,
} from '../src/services/rapprochementLieux.service';

/**
 * Relire les lieux d'une demande, et ne rien perdre de ce qu'on n'a pas compris.
 *
 * Le formulaire envoie ses salles en une phrase — « Mairie : Salle des mariages
 * ; Maison Pour Tous : Le hall » — produite par `texteLisible`. Deux erreurs
 * sont possibles ici, et la seconde est la dangereuse :
 *
 *   **ne pas reconnaître** un lieu. Le libellé part alors dans `nonReconnus`,
 *   l'agent le voit et l'apparie à la main. C'est pénible, et réparable.
 *
 *   **reconnaître le mauvais**. Un rapprochement plausible et faux réserve une
 *   salle que personne n'avait demandée, en bloque une autre qui l'était, et
 *   rien ne le signale avant le jour de la manifestation.
 *
 * D'où la règle figée ici : on ne propose que ce dont on est sûr, et le doute
 * s'écrit dans `nonReconnus` plutôt que de se résoudre au plus vraisemblable.
 */

/** Le référentiel d'une commune, tel que `referentielAPlat` le rend. */
const REFERENTIEL: LieuReference[] = [
  { siteId: 1, siteNom: 'Mairie', pieceId: 10, pieceNom: 'Salle des Mariages' },
  { siteId: 1, siteNom: 'Mairie', pieceId: 11, pieceNom: 'Hall' },
  { siteId: 2, siteNom: 'Maison Pour Tous', pieceId: 20, pieceNom: 'Le hall' },
  { siteId: 3, siteNom: 'Salle des fêtes', pieceId: 30, pieceNom: 'Cuisine' },
  { siteId: 4, siteNom: 'Centre technique', pieceId: null, pieceNom: null },
];

describe('Découper la phrase du formulaire', () => {
  it('sépare les répétitions au point-virgule, et le couple au deux-points', () => {
    expect(decouperLieux('Mairie : Salle des mariages ; Maison Pour Tous : Le hall')).toEqual([
      { batiment: 'Mairie', piece: 'Salle des mariages' },
      { batiment: 'Maison Pour Tous', piece: 'Le hall' },
    ]);
  });

  it('laisse ambiguë une entrée sans deux-points', () => {
    // « Salle des fêtes » peut nommer un bâtiment comme une pièce : on ne
    // tranche pas au découpage.
    expect(decouperLieux('Salle des fêtes')).toEqual([
      { batiment: null, piece: 'Salle des fêtes' },
    ]);
  });

  it('ne découpe qu’au premier deux-points', () => {
    expect(decouperLieux('Mairie : Salle B : niveau 2')).toEqual([
      { batiment: 'Mairie', piece: 'Salle B : niveau 2' },
    ]);
  });

  it('encaisse les séparateurs doublés, les vides et les retours à la ligne', () => {
    expect(decouperLieux(' ; Mairie : Hall ;; \n Maison Pour Tous : Le hall ; ')).toEqual([
      { batiment: 'Mairie', piece: 'Hall' },
      { batiment: 'Maison Pour Tous', piece: 'Le hall' },
    ]);
  });

  it('ne rend rien d’une réponse vide', () => {
    expect(decouperLieux('')).toEqual([]);
    expect(decouperLieux(null)).toEqual([]);
    expect(decouperLieux('   ;  ; ')).toEqual([]);
  });
});

describe('Rapprocher du référentiel', () => {
  const rapprocher = (texte: string) => rapprocherDansReferentiel(texte, REFERENTIEL);

  it('retrouve la salle exacte de son bâtiment', () => {
    const { trouves, nonReconnus } = rapprocher('Mairie : Salle des mariages')
    expect(nonReconnus).toEqual([]);
    expect(trouves).toHaveLength(1);
    expect(trouves[0]).toMatchObject({ siteId: 1, pieceId: 10, confiance: 'exact' });
  });

  it('ignore la casse et les accents', () => {
    const { trouves } = rapprocher('MAIRIE : salle des mariages');
    expect(trouves[0]).toMatchObject({ pieceId: 10, confiance: 'exact' });
  });

  /**
   * Le cas qui justifie d'exiger que la pièce appartienne au bâtiment nommé.
   * Deux « hall » existent ; sans cette condition, celui de la mairie
   * attraperait celui de la Maison Pour Tous, ou l'inverse.
   */
  it('ne confond pas deux pièces de même nom dans deux bâtiments', () => {
    expect(rapprocher('Mairie : Hall').trouves[0]).toMatchObject({ siteId: 1, pieceId: 11 });
    expect(rapprocher('Maison Pour Tous : Le hall').trouves[0]).toMatchObject({
      siteId: 2,
      pieceId: 20,
    });
  });

  it('accepte un libellé approchant, en le disant', () => {
    // « Le hall » contient « hall » : on rapproche, mais la confiance baisse.
    expect(rapprocher('Mairie : Le hall').trouves[0]).toMatchObject({
      pieceId: 11,
      confiance: 'partiel',
    });
  });

  it('reconnaît un bâtiment entier quand aucune pièce n’est nommée', () => {
    const { trouves } = rapprocher('Centre technique');
    expect(trouves[0]).toMatchObject({ siteId: 4, pieceId: null, confiance: 'exact' });
  });

  it('préfère la pièce au bâtiment quand un seul libellé est donné', () => {
    // Un formulaire qui ne nomme qu'un lieu nomme presque toujours la salle.
    expect(rapprocher('Cuisine').trouves[0]).toMatchObject({ siteId: 3, pieceId: 30 });
  });

  /**
   * Le garde-fou principal.
   *
   * Le bâtiment est connu, la salle non. Rapprocher sur le seul bâtiment
   * réserverait la mairie **entière** — ce qui, avec le conflit hiérarchique,
   * bloquerait toutes ses pièces — alors que la demande visait une salle.
   */
  it('ne se rabat pas sur le bâtiment quand la salle est inconnue', () => {
    const { trouves, nonReconnus } = rapprocher('Mairie : Salle du trône');
    expect(trouves).toEqual([]);
    expect(nonReconnus).toEqual(['Mairie : Salle du trône']);
  });

  it('garde intact ce qu’il n’a pas compris', () => {
    const { trouves, nonReconnus } = rapprocher(
      'Mairie : Salle des mariages ; Le parc municipal ; Maison Pour Tous : Le hall'
    );
    expect(trouves.map((t) => t.pieceId)).toEqual([10, 20]);
    // Le libellé repart tel qu'il est arrivé, pour que l'agent le relise.
    expect(nonReconnus).toEqual(['Le parc municipal']);
  });

  it('n’écrit pas deux fois le même lieu', () => {
    // « Cuisine » et « Salle des fêtes : Cuisine » désignent la même pièce :
    // deux créneaux identiques la mettraient en conflit avec elle-même.
    const { trouves } = rapprocher('Cuisine ; Salle des fêtes : Cuisine');
    expect(trouves).toHaveLength(1);
    expect(trouves[0]).toMatchObject({ siteId: 3, pieceId: 30 });
  });

  it('ne rapproche rien sur un libellé trop court pour être sûr', () => {
    const { trouves, nonReconnus } = rapprocher('Mairie : ha');
    expect(trouves).toEqual([]);
    expect(nonReconnus).toEqual(['Mairie : ha']);
  });

  it('ne dit rien d’une réponse vide, sans rien inventer', () => {
    expect(rapprocher('')).toEqual({ trouves: [], nonReconnus: [] });
  });
});
